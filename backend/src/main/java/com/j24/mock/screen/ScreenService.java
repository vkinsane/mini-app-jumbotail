package com.j24.mock.screen;

import static com.j24.mock.common.Db.instant;
import static com.j24.mock.common.Db.ts;
import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.ApiException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Screen Manager: screens and their slot bookings ("which ad holds which slot, and when"). */
@Service
public class ScreenService {

    public static final Set<String> PLACEMENT_TYPES = Set.of("ENTRANCE", "NEAR_CHECKOUT", "AISLE", "OTHER");
    public static final Set<String> STATUSES = Set.of("ACTIVE", "INACTIVE");

    public record Screen(UUID screenId, UUID storeId, String name, String placementType,
                         Integer widthPixels, Integer heightPixels, int slotsPerLoop, int slotDurationSeconds,
                         String status, Instant lastSeenAt) {
    }

    public record Booking(UUID screenId, int slotIndex) {
    }

    private static final String SCREEN_COLUMNS = """
            id, store_id, name, placement_type, width_pixels, height_pixels,
            slots_per_loop, slot_duration_seconds, status, last_seen_at
            """;

    private final JdbcClient jdbc;

    public ScreenService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public UUID create(UUID storeId, String name, String placementType, Integer widthPixels, Integer heightPixels) {
        if (!PLACEMENT_TYPES.contains(placementType)) {
            throw ApiException.badRequest("placementType must be one of " + PLACEMENT_TYPES);
        }
        UUID screenId = UUID.randomUUID(); // server-generated: no shared counter, no collisions
        jdbc.sql("""
                        INSERT INTO screen (id, store_id, name, placement_type, width_pixels, height_pixels, status)
                        VALUES (:id, :storeId, :name, :placementType, :width, :height, 'ACTIVE')
                        """)
                .param("id", screenId)
                .param("storeId", storeId)
                .param("name", name)
                .param("placementType", placementType)
                .param("width", widthPixels, Types.INTEGER)
                .param("height", heightPixels, Types.INTEGER)
                .update();
        return screenId;
    }

    public List<Screen> listByStore(UUID storeId) {
        return jdbc.sql("SELECT " + SCREEN_COLUMNS + " FROM screen WHERE store_id = :storeId ORDER BY created_at, name")
                .param("storeId", storeId)
                .query((rs, i) -> mapScreen(rs))
                .list();
    }

    public Screen get(UUID screenId) {
        return jdbc.sql("SELECT " + SCREEN_COLUMNS + " FROM screen WHERE id = :id")
                .param("id", screenId)
                .query((rs, i) -> mapScreen(rs))
                .optional()
                .orElseThrow(() -> ApiException.notFound("screen"));
    }

    public Screen setStatus(UUID screenId, String status) {
        if (!STATUSES.contains(status)) {
            throw ApiException.badRequest("status must be one of " + STATUSES);
        }
        int updated = jdbc.sql("UPDATE screen SET status = :status WHERE id = :id")
                .param("status", status)
                .param("id", screenId)
                .update();
        if (updated == 0) {
            throw ApiException.notFound("screen");
        }
        return get(screenId);
    }

    public void markSeen(UUID screenId, Instant now) {
        jdbc.sql("UPDATE screen SET last_seen_at = :now WHERE id = :id")
                .param("now", ts(now))
                .param("id", screenId)
                .update();
    }

    /**
     * Locks the chosen screens (sorted by id, so every publish locks in the same order) and checks
     * they belong to the store and are ACTIVE. While locked, nobody else can book slots on them.
     */
    public List<Screen> lockForBooking(UUID storeId, Collection<UUID> screenIds) {
        List<Screen> locked = new ArrayList<>();
        for (UUID screenId : new TreeSet<>(screenIds)) {
            Screen screen = jdbc.sql("SELECT " + SCREEN_COLUMNS + " FROM screen WHERE id = :id FOR UPDATE")
                    .param("id", screenId)
                    .query((rs, i) -> mapScreen(rs))
                    .optional()
                    .orElseThrow(() -> ApiException.notFound("screen " + screenId));
            requireBookable(storeId, screen);
            locked.add(screen);
        }
        return locked;
    }

    public void requireBookable(UUID storeId, Screen screen) {
        if (!screen.storeId().equals(storeId)) {
            throw ApiException.badRequest("screen " + screen.screenId() + " does not belong to this store");
        }
        if (!"ACTIVE".equals(screen.status())) {
            throw ApiException.badRequest("screen " + screen.name() + " is INACTIVE and cannot be booked");
        }
    }

    /**
     * Free slots on a screen for [start, end): every slot minus the ones held by an active booking
     * whose range overlaps (existing starts before the new one ends AND ends after the new one starts).
     */
    public List<Integer> freeSlots(Screen screen, Instant start, Instant end) {
        Set<Integer> taken = new TreeSet<>(jdbc.sql("""
                        SELECT slot_index FROM slot_booking
                        WHERE screen_id = :screenId AND active
                          AND start_time < :end AND end_time > :start
                        """)
                .param("screenId", screen.screenId())
                .param("start", ts(start))
                .param("end", ts(end))
                .query(Integer.class)
                .list());
        List<Integer> free = new ArrayList<>();
        for (int slot = 0; slot < screen.slotsPerLoop(); slot++) {
            if (!taken.contains(slot)) {
                free.add(slot);
            }
        }
        return free;
    }

    /**
     * Picks the slots on each screen: each requested one if still free; a null request takes the lowest free one.
     * The same slot asked for twice is booked once.
     * Must run after {@link #lockForBooking}, so the answer can't change before we insert.
     */
    public List<Booking> chooseSlots(List<Screen> lockedScreens, Map<UUID, List<Integer>> requestedSlots,
                                     Instant start, Instant end) {
        List<Booking> bookings = new ArrayList<>();
        for (Screen screen : lockedScreens) {
            List<Integer> free = freeSlots(screen, start, end);
            Set<Integer> chosen = new TreeSet<>();
            for (Integer requested : requestedSlots.get(screen.screenId())) {
                if (requested != null && !free.contains(requested)) {
                    throw new ApiException(HttpStatus.CONFLICT, "SLOT_TAKEN",
                            "slot " + requested + " on " + screen.name() + " was just booked, pick another",
                            Map.of("screenId", screen.screenId(), "freeSlots", free));
                }
                Integer slot = requested != null ? requested
                        : free.stream().filter(s -> !chosen.contains(s)).findFirst().orElse(null);
                if (slot == null) {
                    throw new ApiException(HttpStatus.CONFLICT, "SLOT_TAKEN",
                            "no free slot on " + screen.name() + " for this time range",
                            Map.of("screenId", screen.screenId(), "freeSlots", free));
                }
                chosen.add(slot);
            }
            chosen.forEach(slot -> bookings.add(new Booking(screen.screenId(), slot)));
        }
        return bookings;
    }

    public void book(UUID adId, List<Booking> bookings, Instant start, Instant end) {
        for (Booking booking : bookings) {
            jdbc.sql("""
                            INSERT INTO slot_booking (id, ad_id, screen_id, slot_index, start_time, end_time, active)
                            VALUES (:id, :adId, :screenId, :slotIndex, :start, :end, TRUE)
                            """)
                    .param("id", UUID.randomUUID())
                    .param("adId", adId)
                    .param("screenId", booking.screenId())
                    .param("slotIndex", booking.slotIndex())
                    .param("start", ts(start))
                    .param("end", ts(end))
                    .update();
        }
    }

    /** Cancel: the ad's slots become free for other ads. */
    public void freeSlotsOfAd(UUID adId) {
        jdbc.sql("UPDATE slot_booking SET active = FALSE WHERE ad_id = :adId")
                .param("adId", adId)
                .update();
    }

    private static Screen mapScreen(ResultSet rs) throws SQLException {
        return new Screen(uuid(rs, "id"), uuid(rs, "store_id"), rs.getString("name"),
                rs.getString("placement_type"), (Integer) rs.getObject("width_pixels"),
                (Integer) rs.getObject("height_pixels"), rs.getInt("slots_per_loop"),
                rs.getInt("slot_duration_seconds"), rs.getString("status"), instant(rs, "last_seen_at"));
    }
}
