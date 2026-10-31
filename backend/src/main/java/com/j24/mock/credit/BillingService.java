package com.j24.mock.credit;

import static com.j24.mock.common.Db.instant;
import static com.j24.mock.common.Db.ts;
import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.StoreTime;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** `ad_daily_billing`: one row per ad per day, created HELD at publish and SETTLED once. */
@Service
public class BillingService {

    /** One IST day of an ad: the part of the ad's range that falls on that day. */
    public record DayPlan(LocalDate date, Instant windowStart, Instant windowEnd, long playsPerScreen) {
    }

    public record BillingRow(UUID id, LocalDate date, int bookedPlays, long held, String status,
                             long deducted, long released, Instant settledAt) {
    }

    private final JdbcClient jdbc;
    private final CreditService credits;

    public BillingService(JdbcClient jdbc, CreditService credits) {
        this.jdbc = jdbc;
        this.credits = credits;
    }

    /** Splits [start, end) into IST days. A booked slot plays once a minute, so plays = minutes. */
    public static List<DayPlan> planDays(Instant start, Instant end) {
        List<DayPlan> days = new ArrayList<>();
        for (LocalDate date = StoreTime.dateOf(start); StoreTime.startOfDay(date).isBefore(end); date = date.plusDays(1)) {
            Instant windowStart = StoreTime.max(StoreTime.startOfDay(date), start);
            Instant windowEnd = StoreTime.min(StoreTime.endOfDay(date), end);
            long plays = StoreTime.minutesBetween(windowStart, windowEnd);
            if (plays > 0) {
                days.add(new DayPlan(date, windowStart, windowEnd, plays));
            }
        }
        return days;
    }

    public static long totalCost(List<DayPlan> days, int screenCount, long pricePerPlay) {
        return days.stream().mapToLong(day -> day.playsPerScreen() * screenCount * pricePerPlay).sum();
    }

    public void createRows(UUID adId, List<DayPlan> days, int screenCount, long pricePerPlay) {
        for (DayPlan day : days) {
            long bookedPlays = day.playsPerScreen() * screenCount;
            jdbc.sql("""
                            INSERT INTO ad_daily_billing (id, ad_id, date, booked_plays, held, status)
                            VALUES (:id, :adId, :date, :bookedPlays, :held, 'HELD')
                            """)
                    .param("id", UUID.randomUUID())
                    .param("adId", adId)
                    .param("date", day.date())
                    .param("bookedPlays", bookedPlays)
                    .param("held", bookedPlays * pricePerPlay)
                    .update();
        }
    }

    public List<BillingRow> rowsForAd(UUID adId) {
        return jdbc.sql("""
                        SELECT id, date, booked_plays, held, status, deducted, released, settled_at
                        FROM ad_daily_billing WHERE ad_id = :adId ORDER BY date
                        """)
                .param("adId", adId)
                .query((rs, i) -> new BillingRow(
                        uuid(rs, "id"), rs.getObject("date", LocalDate.class), rs.getInt("booked_plays"),
                        rs.getLong("held"), rs.getString("status"), rs.getLong("deducted"),
                        rs.getLong("released"), instant(rs, "settled_at")))
                .list();
    }

    /**
     * Cancel: every day whose window has not started yet is released in full right away.
     * A day already running stays HELD and settles normally (only plays before the cancel are billed).
     * Caller must hold the wallet lock.
     */
    public long releaseNotStarted(UUID storeId, UUID adId, Instant adStart, Instant now) {
        List<BillingRow> held = jdbc.sql("""
                        SELECT id, date, booked_plays, held, status, deducted, released, settled_at
                        FROM ad_daily_billing WHERE ad_id = :adId AND status = 'HELD' ORDER BY id FOR UPDATE
                        """)
                .param("adId", adId)
                .query((rs, i) -> new BillingRow(
                        uuid(rs, "id"), rs.getObject("date", LocalDate.class), rs.getInt("booked_plays"),
                        rs.getLong("held"), rs.getString("status"), rs.getLong("deducted"),
                        rs.getLong("released"), instant(rs, "settled_at")))
                .list();

        long released = 0;
        for (BillingRow row : held) {
            Instant windowStart = StoreTime.max(StoreTime.startOfDay(row.date()), adStart);
            if (windowStart.isAfter(now)) {
                markSettled(row.id(), 0, row.held(), now);
                released += row.held();
            }
        }
        if (released > 0) {
            credits.settle(storeId, adId, 0, released);
        }
        return released;
    }

    /** Guarded by status = 'HELD', so a row can only ever be settled once. */
    boolean markSettled(UUID billingId, long deducted, long released, Instant now) {
        return jdbc.sql("""
                        UPDATE ad_daily_billing
                        SET status = 'SETTLED', deducted = :deducted, released = :released, settled_at = :now
                        WHERE id = :id AND status = 'HELD'
                        """)
                .param("deducted", deducted)
                .param("released", released)
                .param("now", ts(now))
                .param("id", billingId)
                .update() == 1;
    }
}
