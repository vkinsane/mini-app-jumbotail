package com.j24.mock.screen;

import static com.j24.mock.common.Db.instant;
import static com.j24.mock.common.Db.ts;
import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.J24Properties;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Every minute: find screens that are INACTIVE or haven't synced for 10 minutes (2 missed syncs),
 * alert J24 admin once per outage, and clear the alert when the screen is healthy again.
 * J24 admin then tells the store owner. (The "alert" here is a log line + an in-memory list.)
 */
@Component
public class ScreenHealthJob {

    private static final Logger log = LoggerFactory.getLogger(ScreenHealthJob.class);

    public record Alert(UUID screenId, UUID storeId, String screenName, String reason, Instant since) {
    }

    private final JdbcClient jdbc;
    private final J24Properties properties;
    private final Map<UUID, Alert> openAlerts = new ConcurrentHashMap<>();

    public ScreenHealthJob(JdbcClient jdbc, J24Properties properties) {
        this.jdbc = jdbc;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "PT1M", initialDelayString = "PT10S")
    public void check() {
        Instant now = Instant.now();
        Instant cutoff = now.minus(Duration.ofMinutes(properties.screenOfflineAfterMinutes()));
        List<Alert> unhealthy = jdbc.sql("""
                        SELECT id, store_id, name, status, last_seen_at, created_at FROM screen
                        WHERE status = 'INACTIVE'
                           OR COALESCE(last_seen_at, created_at) < :cutoff
                        """)
                .param("cutoff", ts(cutoff))
                .query((rs, i) -> {
                    Instant lastSeen = instant(rs, "last_seen_at");
                    String reason = "INACTIVE".equals(rs.getString("status"))
                            ? "marked INACTIVE"
                            : lastSeen == null ? "never synced" : "not seen since " + lastSeen;
                    return new Alert(uuid(rs, "id"), uuid(rs, "store_id"), rs.getString("name"), reason, now);
                })
                .list();

        Set<UUID> stillUnhealthy = new HashSet<>();
        for (Alert alert : unhealthy) {
            stillUnhealthy.add(alert.screenId());
            if (openAlerts.putIfAbsent(alert.screenId(), alert) == null) {
                log.warn("ALERT J24 admin: screen '{}' ({}) of store {} is unavailable: {}",
                        alert.screenName(), alert.screenId(), alert.storeId(), alert.reason());
            }
        }
        openAlerts.keySet().removeIf(screenId -> {
            boolean recovered = !stillUnhealthy.contains(screenId);
            if (recovered) {
                log.info("Screen {} is healthy again, alert cleared", screenId);
            }
            return recovered;
        });
    }

    public List<Alert> openAlerts() {
        return new ArrayList<>(openAlerts.values());
    }
}
