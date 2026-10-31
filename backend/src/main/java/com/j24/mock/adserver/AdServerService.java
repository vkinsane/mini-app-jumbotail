package com.j24.mock.adserver;

import static com.j24.mock.common.Db.instant;
import static com.j24.mock.common.Db.ts;
import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.ApiException;
import com.j24.mock.common.J24Properties;
import com.j24.mock.screen.ScreenService;
import com.j24.mock.screen.ScreenService.Screen;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ad Server: the only thing screens talk to. The screen pulls (the server never calls a screen):
 * it uploads its play logs and always gets back the full playlist for the next 3 days.
 */
@Service
public class AdServerService {

    private static final Logger log = LoggerFactory.getLogger(AdServerService.class);
    private static final int MAX_PLAY_LOGS_PER_SYNC = 500;

    public record PlayLog(UUID playId, UUID adId, int slotIndex, Instant playedAt) {
    }

    public record PlaylistItem(UUID adId, int slotIndex, String name, String headline, Instant startTime,
                               Instant endTime, String imageUrl) {
    }

    public record Playlist(Instant validUntil, int slotsPerLoop, int slotDurationSeconds, String screenStatus,
                           List<PlaylistItem> items) {
    }

    public record SyncResult(List<UUID> receivedPlayIds, Instant serverTime, Playlist playlist) {
    }

    private final JdbcClient jdbc;
    private final ScreenService screens;
    private final J24Properties properties;

    public AdServerService(JdbcClient jdbc, ScreenService screens, J24Properties properties) {
        this.jdbc = jdbc;
        this.screens = screens;
        this.properties = properties;
    }

    @Transactional
    public SyncResult sync(UUID screenId, List<PlayLog> playLogs) {
        Screen screen = screens.get(screenId);
        List<PlayLog> logs = playLogs == null ? List.of() : playLogs;
        if (logs.size() > MAX_PLAY_LOGS_PER_SYNC) {
            throw ApiException.badRequest("send at most " + MAX_PLAY_LOGS_PER_SYNC + " play logs per sync");
        }

        Instant now = Instant.now();
        List<UUID> received = new ArrayList<>();
        for (PlayLog playLog : logs) {
            storePlayLog(screenId, playLog, now);
            // Acknowledge every play, even duplicates or rejected ones, so the screen can drop it from its queue.
            received.add(playLog.playId());
        }
        screens.markSeen(screenId, now);
        return new SyncResult(received, now, playlist(screen, now));
    }

    /** play_id is the primary key: a play uploaded twice (retry after a timeout) is stored once. */
    private void storePlayLog(UUID screenId, PlayLog playLog, Instant now) {
        if (playLog.playId() == null || playLog.adId() == null || playLog.playedAt() == null) {
            log.warn("PLAY_REJECTED screen={} reason=missing fields", screenId);
            return;
        }
        if (playLog.playedAt().isAfter(now.plus(Duration.ofMinutes(1)))) {
            log.warn("PLAY_REJECTED screen={} play={} reason=played in the future", screenId, playLog.playId());
            return;
        }
        int inserted = jdbc.sql("""
                        INSERT INTO play_log (play_id, screen_id, ad_id, slot_index, played_at, received_at)
                        SELECT :playId, :screenId, :adId, :slotIndex, :playedAt, :now
                        WHERE EXISTS (SELECT 1 FROM ad WHERE id = :adId)
                        ON CONFLICT (play_id) DO NOTHING
                        """)
                .param("playId", playLog.playId())
                .param("screenId", screenId)
                .param("adId", playLog.adId())
                .param("slotIndex", playLog.slotIndex())
                .param("playedAt", ts(playLog.playedAt()))
                .param("now", ts(now))
                .update();
        if (inserted == 0) {
            log.debug("Play {} already stored or unknown ad", playLog.playId());
        }
    }

    /** Every ACTIVE ad booked on this screen whose range overlaps [now, now + 3 days). */
    private Playlist playlist(Screen screen, Instant now) {
        Instant validUntil = now.plus(Duration.ofDays(properties.playlistDays()));
        List<PlaylistItem> items = "ACTIVE".equals(screen.status())
                ? jdbc.sql("""
                                SELECT sb.ad_id, sb.slot_index, a.name, a.headline, a.start_time, a.end_time,
                                       (a.image IS NOT NULL) AS has_image
                                FROM slot_booking sb JOIN ad a ON a.id = sb.ad_id
                                WHERE sb.screen_id = :screenId AND sb.active AND a.status = 'ACTIVE'
                                  AND sb.start_time < :validUntil AND sb.end_time > :now
                                ORDER BY sb.slot_index, a.start_time
                                """)
                        .param("screenId", screen.screenId())
                        .param("validUntil", ts(validUntil))
                        .param("now", ts(now))
                        .query((rs, i) -> {
                            UUID adId = uuid(rs, "ad_id");
                            return new PlaylistItem(adId, rs.getInt("slot_index"), rs.getString("name"),
                                    rs.getString("headline"), instant(rs, "start_time"), instant(rs, "end_time"),
                                    rs.getBoolean("has_image") ? "/api/v1/ads/" + adId + "/image" : null);
                        })
                        .list()
                : List.of(); // an INACTIVE screen gets an empty playlist and shows house content
        return new Playlist(validUntil, screen.slotsPerLoop(), screen.slotDurationSeconds(), screen.status(), items);
    }
}
