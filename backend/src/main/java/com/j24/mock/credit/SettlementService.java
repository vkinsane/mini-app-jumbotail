package com.j24.mock.credit;

import static com.j24.mock.common.Db.instant;
import static com.j24.mock.common.Db.ts;
import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.J24Properties;
import com.j24.mock.common.StoreTime;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Settlement: charge only for plays that aired, release the rest. Runs every minute.
 *
 * A HELD ad-day is settled once the ad's window for that day has ended AND either
 * every booked screen has synced after the window (so all its plays are uploaded),
 * or the grace period has passed (a screen that never came back).
 */
@Service
public class SettlementService {

    private static final Logger log = LoggerFactory.getLogger(SettlementService.class);

    public record SettlementResult(int settled, long deducted, long released) {
    }

    private record Candidate(UUID billingId, UUID storeId) {
    }

    private record HeldDay(UUID id, UUID adId, LocalDate date, long held, long pricePerPlay,
                           Instant adStart, Instant adEnd) {
    }

    private final JdbcClient jdbc;
    private final CreditService credits;
    private final BillingService billing;
    private final TransactionTemplate tx;
    private final J24Properties properties;

    public SettlementService(JdbcClient jdbc, CreditService credits, BillingService billing,
                             TransactionTemplate tx, J24Properties properties) {
        this.jdbc = jdbc;
        this.credits = credits;
        this.billing = billing;
        this.tx = tx;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "PT1M", initialDelayString = "PT20S")
    public void scheduledRun() {
        SettlementResult result = run(false);
        if (result.settled() > 0) {
            log.info("Settlement: {}", result);
        }
    }

    /**
     * @param skipGrace demo switch: don't wait for offline screens, settle every ad-day whose window has ended.
     */
    public SettlementResult run(boolean skipGrace) {
        Instant now = Instant.now();
        List<Candidate> candidates = jdbc.sql("""
                        SELECT b.id, a.store_id FROM ad_daily_billing b JOIN ad a ON a.id = b.ad_id
                        WHERE b.status = 'HELD' AND b.date <= :today ORDER BY b.date
                        """)
                .param("today", StoreTime.dateOf(now))
                .query((rs, i) -> new Candidate(uuid(rs, "id"), uuid(rs, "store_id")))
                .list();

        int settled = 0;
        long deducted = 0;
        long released = 0;
        for (Candidate candidate : candidates) {
            // One transaction per ad-day: a failure on one never blocks the others.
            long[] outcome = tx.execute(status -> settleIfReady(candidate, now, skipGrace));
            if (outcome != null) {
                settled++;
                deducted += outcome[0];
                released += outcome[1];
            }
        }
        return new SettlementResult(settled, deducted, released);
    }

    /** @return {deducted, released}, or null if not ready / already taken by another worker. */
    private long[] settleIfReady(Candidate candidate, Instant now, boolean skipGrace) {
        credits.lockWallet(candidate.storeId()); // same lock order as publish and cancel: wallet first

        HeldDay day = jdbc.sql("""
                        SELECT b.id, b.ad_id, b.date, b.held, a.price_per_play, a.start_time, a.end_time
                        FROM ad_daily_billing b JOIN ad a ON a.id = b.ad_id
                        WHERE b.id = :id AND b.status = 'HELD'
                        FOR UPDATE OF b SKIP LOCKED
                        """)
                .param("id", candidate.billingId())
                .query((rs, i) -> new HeldDay(uuid(rs, "id"), uuid(rs, "ad_id"), rs.getObject("date", LocalDate.class),
                        rs.getLong("held"), rs.getLong("price_per_play"),
                        instant(rs, "start_time"), instant(rs, "end_time")))
                .optional()
                .orElse(null);
        if (day == null) {
            return null;
        }

        Instant windowStart = StoreTime.max(StoreTime.startOfDay(day.date()), day.adStart());
        Instant windowEnd = StoreTime.min(StoreTime.endOfDay(day.date()), day.adEnd());
        if (now.isBefore(windowEnd)) {
            return null; // the ad is still on air for this day
        }
        boolean graceOver = skipGrace
                || !now.isBefore(windowEnd.plus(Duration.ofHours(properties.settlementGraceHours())));
        if (!graceOver && !allScreensSyncedAfter(day.adId(), windowEnd)) {
            return null; // wait for offline screens to upload their plays
        }

        long playsPerScreen = StoreTime.minutesBetween(windowStart, windowEnd);
        long billablePlays = countActivePlaysPerScreen(day.adId(), windowStart, windowEnd).values().stream()
                .mapToLong(plays -> Math.min(plays, playsPerScreen)) // never bill a screen more than it booked
                .sum();
        long deducted = Math.min(billablePlays * day.pricePerPlay(), day.held());
        long released = day.held() - deducted;

        if (!billing.markSettled(day.id(), deducted, released, now)) {
            return null;
        }
        credits.settle(candidate.storeId(), day.adId(), deducted, released);
        log.info("Settled ad={} date={} deducted={} released={}", day.adId(), day.date(), deducted, released);
        return new long[] {deducted, released};
    }

    private boolean allScreensSyncedAfter(UUID adId, Instant windowEnd) {
        return jdbc.sql("""
                        SELECT NOT EXISTS (
                            SELECT 1 FROM slot_booking sb JOIN screen s ON s.id = sb.screen_id
                            WHERE sb.ad_id = :adId AND (s.last_seen_at IS NULL OR s.last_seen_at < :windowEnd)
                        )
                        """)
                .param("adId", adId)
                .param("windowEnd", ts(windowEnd))
                .query(Boolean.class)
                .single();
    }

    /** Plays inside the window, on a screen the ad was booked on, while the ad was ACTIVE. */
    private Map<UUID, Long> countActivePlaysPerScreen(UUID adId, Instant from, Instant to) {
        return jdbc.sql("""
                        SELECT p.screen_id, COUNT(*) AS plays
                        FROM play_log p
                        WHERE p.ad_id = :adId
                          AND p.played_at >= :from AND p.played_at < :to
                          AND EXISTS (SELECT 1 FROM slot_booking sb
                                      WHERE sb.ad_id = p.ad_id AND sb.screen_id = p.screen_id)
                          AND (SELECT h.status FROM ad_status_history h
                               WHERE h.ad_id = p.ad_id AND h.changed_at <= p.played_at
                               ORDER BY h.changed_at DESC, h.id DESC LIMIT 1) = 'ACTIVE'
                        GROUP BY p.screen_id
                        """)
                .param("adId", adId)
                .param("from", ts(from))
                .param("to", ts(to))
                .query((rs, i) -> Map.entry(uuid(rs, "screen_id"), rs.getLong("plays")))
                .list()
                .stream()
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }
}
