package com.j24.mock;

import static com.j24.mock.common.Db.ts;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.j24.mock.ad.AdService;
import com.j24.mock.ad.AdService.AdDraft;
import com.j24.mock.ad.AdService.Published;
import com.j24.mock.ad.AdService.ScreenChoice;
import com.j24.mock.adserver.AdServerService;
import com.j24.mock.adserver.AdServerService.PlayLog;
import com.j24.mock.common.ApiException;
import com.j24.mock.credit.CreditService;
import com.j24.mock.credit.CreditService.Wallet;
import com.j24.mock.credit.SettlementService;
import com.j24.mock.screen.ScreenService;
import com.j24.mock.store.StoreService;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

/** Runs against a real Postgres (j24mock_test) because the guarantees rely on its row locks. */
@SpringBootTest
@ActiveProfiles("test")
class J24FlowsTest {

    @Autowired JdbcClient jdbc;
    @Autowired StoreService stores;
    @Autowired ScreenService screens;
    @Autowired CreditService credits;
    @Autowired AdService ads;
    @Autowired AdServerService adServer;
    @Autowired SettlementService settlement;

    UUID storeId;
    UUID tv1;
    UUID tv2;

    @BeforeEach
    void freshStore() {
        jdbc.sql("TRUNCATE play_log, ad_daily_billing, credit_transactions, slot_booking, ad_status_history, ad, "
                + "wallet, screen, store CASCADE").update();
        storeId = stores.create("Test Kirana", "Owner", null, null);
        tv1 = screens.create(storeId, "TV 1", "ENTRANCE", null, null);
        tv2 = screens.create(storeId, "TV 2", "AISLE", null, null);
    }

    @Test
    void parallelPublishesNeverSpendTheSameCredits() throws Exception {
        credits.purchase(storeId, 30); // covers exactly 3 ads of 10 plays on one screen
        Instant start = nextMinute();
        ExecutorService pool = Executors.newFixedThreadPool(10);
        List<Callable<Boolean>> attempts = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            int slotRange = i;
            attempts.add(() -> {
                try {
                    // Different 10-minute ranges on the same slot so only credits limit them.
                    Instant from = start.plus(Duration.ofMinutes(10L * slotRange));
                    ads.publish(draft(from, from.plus(Duration.ofMinutes(10)), tv1), null, null);
                    return true;
                } catch (ApiException e) {
                    assertThat(e.code()).isEqualTo("INSUFFICIENT_CREDITS");
                    return false;
                }
            });
        }
        long succeeded = 0;
        for (Future<Boolean> result : pool.invokeAll(attempts)) {
            succeeded += result.get() ? 1 : 0;
        }
        pool.shutdown();

        assertThat(succeeded).isEqualTo(3);
        assertThat(credits.getWallet(storeId)).isEqualTo(new Wallet(storeId, 0, 30));
    }

    @Test
    void sameSlotCannotBeBookedTwice() {
        credits.purchase(storeId, 1000);
        Instant start = nextMinute();
        ads.publish(new AdDraft(storeId, "A", "A", start, start.plus(Duration.ofMinutes(5)),
                List.of(new ScreenChoice(tv1, 2))), null, null);

        assertThatThrownBy(() -> ads.publish(new AdDraft(storeId, "B", "B", start.plus(Duration.ofMinutes(2)),
                start.plus(Duration.ofMinutes(8)), List.of(new ScreenChoice(tv1, 2))), null, null))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code())
                .isEqualTo("SLOT_TAKEN");
    }

    @Test
    void settlementChargesOnlyPlaysThatAiredWhileActive() {
        credits.purchase(storeId, 100);
        Instant start = nextMinute();
        Published ad = ads.publish(draft(start, start.plus(Duration.ofMinutes(10)), tv1, tv2), null, null);
        assertThat(credits.getWallet(storeId)).isEqualTo(new Wallet(storeId, 80, 20)); // 10 plays x 2 screens

        // Move the whole ad 15 minutes into the past so its window is over.
        shiftAdIntoPast(ad.adId(), Duration.ofMinutes(15));
        Instant windowStart = start.minus(Duration.ofMinutes(15));

        // TV1 aired 6 plays, but 2 of them while the ad was paused. TV2 aired 3 (it was off for a while).
        jdbc.sql("INSERT INTO ad_status_history (ad_id, status, changed_at) VALUES (:id, 'PAUSED', :p), (:id, 'ACTIVE', :r)")
                .param("id", ad.adId())
                .param("p", ts(windowStart.plus(Duration.ofSeconds(150))))
                .param("r", ts(windowStart.plus(Duration.ofSeconds(270))))
                .update();
        List<PlayLog> tv1Plays = plays(ad.adId(), windowStart, 0, 1, 2, 3, 4, 5); // minutes 2 and 3 are paused
        adServer.sync(tv1, tv1Plays);
        adServer.sync(tv1, tv1Plays); // retry after a timeout: counted once
        adServer.sync(tv2, plays(ad.adId(), windowStart, 0, 1, 2));

        var result = settlement.run(false);

        assertThat(result.settled()).isEqualTo(1);
        assertThat(result.deducted()).isEqualTo(4 + 3);
        assertThat(result.released()).isEqualTo(20 - 7);
        assertThat(credits.getWallet(storeId)).isEqualTo(new Wallet(storeId, 80 + 13, 0));
        assertThat(settlement.run(false).settled()).isZero(); // settles exactly once
    }

    @Test
    void oneScreenCanHoldSeveralSlotsOfTheSameAd() {
        credits.purchase(storeId, 100);
        Instant start = nextMinute();
        Published ad = ads.publish(new AdDraft(storeId, "A", "A", start, start.plus(Duration.ofMinutes(10)),
                List.of(new ScreenChoice(tv1, 1), new ScreenChoice(tv1, 4))), null, null);
        assertThat(ad.bookings()).hasSize(2);
        assertThat(credits.getWallet(storeId)).isEqualTo(new Wallet(storeId, 80, 20)); // 10 plays x 2 slots

        shiftAdIntoPast(ad.adId(), Duration.ofMinutes(15));
        Instant windowStart = start.minus(Duration.ofMinutes(15));
        List<PlayLog> logs = new ArrayList<>();
        for (int minute = 0; minute < 10; minute++) {
            logs.add(new PlayLog(UUID.randomUUID(), ad.adId(), 1, windowStart.plus(Duration.ofSeconds(60L * minute + 15))));
        }
        for (int minute = 0; minute < 4; minute++) { // slot 4 aired only 4 times
            logs.add(new PlayLog(UUID.randomUUID(), ad.adId(), 4, windowStart.plus(Duration.ofSeconds(60L * minute + 45))));
        }
        adServer.sync(tv1, logs);

        var result = settlement.run(false);

        assertThat(result.deducted()).isEqualTo(10 + 4);
        assertThat(result.released()).isEqualTo(6);
    }

    @Test
    void settlementWaitsForOfflineScreens() {
        credits.purchase(storeId, 100);
        Instant start = nextMinute();
        Published ad = ads.publish(draft(start, start.plus(Duration.ofMinutes(5)), tv1, tv2), null, null);
        shiftAdIntoPast(ad.adId(), Duration.ofMinutes(10));
        adServer.sync(tv1, List.of()); // TV2 never comes back

        assertThat(settlement.run(false).settled()).isZero();
        assertThat(settlement.run(true).released()).isEqualTo(10); // grace skipped: nothing aired, all returned
    }

    @Test
    void cancelReleasesDaysThatHaveNotStarted() {
        credits.purchase(storeId, 10_000);
        Instant start = nextMinute().plus(Duration.ofDays(1));
        ads.publish(draft(start, start.plus(Duration.ofHours(2)), tv1), null, null);
        UUID adId = ads.list(storeId).getFirst().adId();

        var cancelled = ads.cancel(adId);

        assertThat(cancelled.get("releasedCredits")).isEqualTo(120L);
        assertThat(credits.getWallet(storeId)).isEqualTo(new Wallet(storeId, 10_000, 0));
        // The slot is free again.
        ads.publish(draft(start, start.plus(Duration.ofHours(2)), tv1), null, null);
    }

    private AdDraft draft(Instant start, Instant end, UUID... screenIds) {
        return new AdDraft(storeId, "Ad", "Headline", start, end,
                java.util.Arrays.stream(screenIds).map(id -> new ScreenChoice(id, null)).toList());
    }

    private List<PlayLog> plays(UUID adId, Instant windowStart, int... minutes) {
        List<PlayLog> logs = new ArrayList<>();
        for (int minute : minutes) {
            logs.add(new PlayLog(UUID.randomUUID(), adId, 0, windowStart.plus(Duration.ofSeconds(60L * minute + 5))));
        }
        return logs;
    }

    private void shiftAdIntoPast(UUID adId, Duration by) {
        String interval = by.toMinutes() + " minutes";
        jdbc.sql("UPDATE ad SET start_time = start_time - CAST(:i AS interval), end_time = end_time - CAST(:i AS interval) WHERE id = :id")
                .param("i", interval).param("id", adId).update();
        jdbc.sql("UPDATE slot_booking SET start_time = start_time - CAST(:i AS interval), end_time = end_time - CAST(:i AS interval) WHERE ad_id = :id")
                .param("i", interval).param("id", adId).update();
        jdbc.sql("UPDATE ad_status_history SET changed_at = changed_at - CAST(:i AS interval) - interval '1 minute' WHERE ad_id = :id")
                .param("i", interval).param("id", adId).update();
    }

    private static Instant nextMinute() {
        return Instant.now().truncatedTo(ChronoUnit.MINUTES).plus(Duration.ofMinutes(1));
    }
}
