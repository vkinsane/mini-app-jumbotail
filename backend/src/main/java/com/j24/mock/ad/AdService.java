package com.j24.mock.ad;

import static com.j24.mock.common.Db.instant;
import static com.j24.mock.common.Db.ts;
import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.ApiException;
import com.j24.mock.credit.BillingService;
import com.j24.mock.credit.BillingService.BillingRow;
import com.j24.mock.credit.BillingService.DayPlan;
import com.j24.mock.credit.CreditService;
import com.j24.mock.credit.CreditService.Wallet;
import com.j24.mock.screen.ScreenService;
import com.j24.mock.screen.ScreenService.Booking;
import com.j24.mock.screen.ScreenService.Screen;
import com.j24.mock.store.StoreService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Ad Manager: publish, pause, resume, cancel. Asks Screen Manager for slots and Credit Manager for money. */
@Service
public class AdService {

    /** 1 credit = ₹1 = 1 play (one 10-second slot airing once on one screen). */
    public static final long PRICE_PER_PLAY = 1;
    private static final Duration MAX_AD_LENGTH = Duration.ofDays(30);

    public record ScreenChoice(UUID screenId, Integer slotIndex) {
    }

    public record AdDraft(UUID storeId, String name, String headline, Instant startTime, Instant endTime,
                          List<ScreenChoice> screens) {
    }

    public record Image(byte[] bytes, String contentType) {
    }

    public record ScreenAvailability(UUID screenId, String screenName, List<Integer> freeSlots) {
    }

    public record Availability(List<ScreenAvailability> screens, long playsPerScreen, long totalCost,
                               long available, long missingCredits) {
    }

    public record Published(UUID adId, long totalCost, List<Booking> bookings) {
    }

    public record Ad(UUID adId, UUID storeId, String name, String headline, Instant startTime, Instant endTime,
                     String status, long pricePerPlay, long totalCost, boolean hasImage,
                     Instant createdAt, Instant updatedAt) {

        /** "ENDED" is not stored: it's an ACTIVE/PAUSED ad whose end_time has passed. */
        public String displayStatus(Instant now) {
            return !"CANCELLED".equals(status) && !endTime.isAfter(now) ? "ENDED" : status;
        }
    }

    public record BookingView(UUID screenId, String screenName, int slotIndex, boolean active) {
    }

    private static final String AD_COLUMNS = """
            id, store_id, name, headline, start_time, end_time, status, price_per_play, total_cost,
            (image IS NOT NULL) AS has_image, created_at, updated_at
            """;

    private final JdbcClient jdbc;
    private final StoreService stores;
    private final ScreenService screens;
    private final CreditService credits;
    private final BillingService billing;

    public AdService(JdbcClient jdbc, StoreService stores, ScreenService screens, CreditService credits,
                     BillingService billing) {
        this.jdbc = jdbc;
        this.stores = stores;
        this.screens = screens;
        this.credits = credits;
        this.billing = billing;
    }

    /** Read-only preview: free slots per screen, cost, and how many credits are missing. Nothing is locked. */
    public Availability availability(UUID storeId, List<UUID> screenIds, Instant startTime, Instant endTime) {
        stores.requireExists(storeId);
        Instant start = effectiveStart(startTime);
        validateRange(start, endTime);
        Set<UUID> ids = requireScreens(screenIds);

        List<ScreenAvailability> result = ids.stream().map(screenId -> {
            Screen screen = screens.get(screenId);
            screens.requireBookable(storeId, screen);
            return new ScreenAvailability(screenId, screen.name(), screens.freeSlots(screen, start, endTime));
        }).toList();

        List<DayPlan> days = BillingService.planDays(start, endTime);
        long playsPerScreen = days.stream().mapToLong(DayPlan::playsPerScreen).sum();
        long totalCost = BillingService.totalCost(days, ids.size(), PRICE_PER_PLAY);
        long available = credits.getWallet(storeId).available();
        return new Availability(result, playsPerScreen, totalCost, available, Math.max(0, totalCost - available));
    }

    /**
     * Publish = one database transaction:
     * lock wallet -> lock screens (sorted) -> re-check slots (409) -> check credits (402)
     * -> insert ad, slot bookings, daily billing rows (HELD) -> move cost from available to held.
     * Either everything is written or nothing is.
     */
    @Transactional
    public Published publish(AdDraft draft, Image image, String idempotencyKey) {
        if (idempotencyKey != null) {
            Optional<Published> previous = findByIdempotencyKey(idempotencyKey);
            if (previous.isPresent()) {
                return previous.get(); // double-click / retry: return the first result
            }
        }
        stores.requireExists(draft.storeId());
        Instant start = effectiveStart(draft.startTime());
        Instant end = draft.endTime();
        validateRange(start, end);
        requireScreens(draft.screens().stream().map(ScreenChoice::screenId).distinct().toList());

        // 1. Wallet first: two publishes from the same store queue up here.
        Wallet wallet = credits.lockWallet(draft.storeId());

        // 2. Screens next, sorted by id; then re-check slots now that nobody else can book them.
        // A screen may appear more than once: one entry per slot the ad wants on it.
        Map<UUID, List<Integer>> requestedSlots = new HashMap<>();
        draft.screens().forEach(choice ->
                requestedSlots.computeIfAbsent(choice.screenId(), id -> new ArrayList<>()).add(choice.slotIndex()));
        List<Screen> locked = screens.lockForBooking(draft.storeId(), requestedSlots.keySet());
        List<Booking> bookings = screens.chooseSlots(locked, requestedSlots, start, end);

        // 3. Credits: the full cost must be available up front.
        List<DayPlan> days = BillingService.planDays(start, end);
        long totalCost = BillingService.totalCost(days, bookings.size(), PRICE_PER_PLAY);
        if (wallet.available() < totalCost) {
            throw new ApiException(HttpStatus.PAYMENT_REQUIRED, "INSUFFICIENT_CREDITS",
                    "You need " + (totalCost - wallet.available()) + " more credits",
                    Map.of("totalCost", totalCost, "available", wallet.available(),
                            "missingCredits", totalCost - wallet.available()));
        }

        // 4. Write everything.
        UUID adId = UUID.randomUUID();
        Instant now = Instant.now();
        jdbc.sql("""
                        INSERT INTO ad (id, store_id, name, headline, image, image_content_type, start_time, end_time,
                                        status, price_per_play, total_cost, idempotency_key, created_at, updated_at)
                        VALUES (:id, :storeId, :name, :headline, :image, :contentType, :start, :end,
                                'ACTIVE', :price, :totalCost, :idempotencyKey, :now, :now)
                        """)
                .param("id", adId)
                .param("storeId", draft.storeId())
                .param("name", draft.name())
                .param("headline", draft.headline())
                .param("image", image == null ? null : image.bytes(), Types.BINARY)
                .param("contentType", image == null ? null : image.contentType(), Types.VARCHAR)
                .param("start", ts(start))
                .param("end", ts(end))
                .param("price", PRICE_PER_PLAY)
                .param("totalCost", totalCost)
                .param("idempotencyKey", idempotencyKey, Types.VARCHAR)
                .param("now", ts(now))
                .update();
        recordStatus(adId, "ACTIVE", now);
        screens.book(adId, bookings, start, end);
        billing.createRows(adId, days, bookings.size(), PRICE_PER_PLAY);
        credits.hold(draft.storeId(), adId, totalCost);
        return new Published(adId, totalCost, bookings);
    }

    /** Pause: no credits move and the slot stays blocked. Skipped plays are released at settlement. */
    @Transactional
    public Ad pause(UUID adId) {
        return changeStatus(adId, "ACTIVE", "PAUSED");
    }

    @Transactional
    public Ad resume(UUID adId) {
        Ad ad = get(adId);
        if (!ad.endTime().isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.CONFLICT, "AD_ENDED", "this ad has already ended");
        }
        return changeStatus(adId, "PAUSED", "ACTIVE");
    }

    /**
     * Cancel: slots are freed and every day that hasn't started yet is released right away.
     * Today's day stays HELD and settles normally, billing only plays made before the cancel.
     */
    @Transactional
    public Map<String, Object> cancel(UUID adId) {
        Ad ad = get(adId);
        credits.lockWallet(ad.storeId()); // wallet first, same lock order as publish and settlement
        Instant now = Instant.now();
        int updated = jdbc.sql("""
                        UPDATE ad SET status = 'CANCELLED', updated_at = :now
                        WHERE id = :id AND status IN ('ACTIVE', 'PAUSED')
                        """)
                .param("now", ts(now))
                .param("id", adId)
                .update();
        if (updated == 0) {
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATUS", "ad is already cancelled");
        }
        recordStatus(adId, "CANCELLED", now);
        screens.freeSlotsOfAd(adId);
        long released = billing.releaseNotStarted(ad.storeId(), adId, ad.startTime(), now);
        return Map.of("adId", adId, "status", "CANCELLED", "releasedCredits", released);
    }

    public List<Ad> list(UUID storeId) {
        stores.requireExists(storeId);
        return jdbc.sql("SELECT " + AD_COLUMNS + " FROM ad WHERE store_id = :storeId ORDER BY created_at DESC")
                .param("storeId", storeId)
                .query((rs, i) -> mapAd(rs))
                .list();
    }

    public Ad get(UUID adId) {
        return jdbc.sql("SELECT " + AD_COLUMNS + " FROM ad WHERE id = :id")
                .param("id", adId)
                .query((rs, i) -> mapAd(rs))
                .optional()
                .orElseThrow(() -> ApiException.notFound("ad"));
    }

    public List<BookingView> bookings(UUID adId) {
        return jdbc.sql("""
                        SELECT sb.screen_id, s.name, sb.slot_index, sb.active
                        FROM slot_booking sb JOIN screen s ON s.id = sb.screen_id
                        WHERE sb.ad_id = :adId ORDER BY s.name
                        """)
                .param("adId", adId)
                .query((rs, i) -> new BookingView(uuid(rs, "screen_id"), rs.getString("name"),
                        rs.getInt("slot_index"), rs.getBoolean("active")))
                .list();
    }

    public List<BillingRow> billingRows(UUID adId) {
        return billing.rowsForAd(adId);
    }

    public long playCount(UUID adId) {
        return jdbc.sql("SELECT COUNT(*) FROM play_log WHERE ad_id = :adId")
                .param("adId", adId)
                .query(Long.class)
                .single();
    }

    public Image image(UUID adId) {
        return jdbc.sql("SELECT image, image_content_type FROM ad WHERE id = :id AND image IS NOT NULL")
                .param("id", adId)
                .query((rs, i) -> new Image(rs.getBytes("image"), rs.getString("image_content_type")))
                .optional()
                .orElseThrow(() -> ApiException.notFound("image"));
    }

    private Ad changeStatus(UUID adId, String from, String to) {
        Instant now = Instant.now();
        // Guarded update: only moves if the ad is in the expected status right now.
        int updated = jdbc.sql("UPDATE ad SET status = :to, updated_at = :now WHERE id = :id AND status = :from")
                .param("to", to)
                .param("now", ts(now))
                .param("id", adId)
                .param("from", from)
                .update();
        if (updated == 0) {
            Ad ad = get(adId);
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATUS",
                    "cannot change ad from " + ad.status() + " to " + to);
        }
        recordStatus(adId, to, now);
        return get(adId);
    }

    private void recordStatus(UUID adId, String status, Instant at) {
        jdbc.sql("INSERT INTO ad_status_history (ad_id, status, changed_at) VALUES (:adId, :status, :at)")
                .param("adId", adId)
                .param("status", status)
                .param("at", ts(at))
                .update();
    }

    private Optional<Published> findByIdempotencyKey(String key) {
        return jdbc.sql("SELECT id, total_cost FROM ad WHERE idempotency_key = :key")
                .param("key", key)
                .query((rs, i) -> new Published(uuid(rs, "id"), rs.getLong("total_cost"), null))
                .optional()
                .map(found -> new Published(found.adId(), found.totalCost(),
                        bookings(found.adId()).stream().map(b -> new Booking(b.screenId(), b.slotIndex())).toList()));
    }

    /** An ad can't be billed for minutes already gone: a start in the past snaps to the current minute. */
    private static Instant effectiveStart(Instant requested) {
        if (requested == null) {
            throw ApiException.badRequest("startTime is required");
        }
        Instant now = Instant.now();
        if (requested.isBefore(now.minus(Duration.ofMinutes(5)))) {
            throw ApiException.badRequest("startTime is in the past");
        }
        return requested.isBefore(now) ? now.truncatedTo(ChronoUnit.MINUTES) : requested;
    }

    private static void validateRange(Instant start, Instant end) {
        if (end == null || !end.isAfter(start)) {
            throw ApiException.badRequest("endTime must be after startTime");
        }
        if (Duration.between(start, end).compareTo(MAX_AD_LENGTH) > 0) {
            throw ApiException.badRequest("an ad can run for at most 30 days");
        }
        if (Duration.between(start, end).toMinutes() < 1) {
            throw ApiException.badRequest("an ad must run for at least 1 minute");
        }
    }

    private static Set<UUID> requireScreens(List<UUID> screenIds) {
        if (screenIds == null || screenIds.isEmpty() || screenIds.contains(null)) {
            throw ApiException.badRequest("choose at least one screen");
        }
        Set<UUID> unique = new LinkedHashSet<>(screenIds);
        if (unique.size() != screenIds.size()) {
            throw ApiException.badRequest("each screen can be chosen only once");
        }
        return unique;
    }

    private static Ad mapAd(ResultSet rs) throws SQLException {
        return new Ad(uuid(rs, "id"), uuid(rs, "store_id"), rs.getString("name"), rs.getString("headline"),
                instant(rs, "start_time"), instant(rs, "end_time"), rs.getString("status"),
                rs.getLong("price_per_play"), rs.getLong("total_cost"), rs.getBoolean("has_image"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }
}
