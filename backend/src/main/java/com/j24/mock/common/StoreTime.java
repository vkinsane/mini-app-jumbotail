package com.j24.mock.common;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/** All dates are store-local IST (see assumptions). */
public final class StoreTime {

    public static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    private StoreTime() {
    }

    public static LocalDate dateOf(Instant instant) {
        return instant.atZone(ZONE).toLocalDate();
    }

    public static Instant startOfDay(LocalDate date) {
        return date.atStartOfDay(ZONE).toInstant();
    }

    public static Instant endOfDay(LocalDate date) {
        return startOfDay(date.plusDays(1));
    }

    /** Whole minutes of [from, to) — one minute is one play on one screen. */
    public static long minutesBetween(Instant from, Instant to) {
        return to.isAfter(from) ? (to.getEpochSecond() - from.getEpochSecond()) / 60 : 0;
    }

    public static Instant max(Instant a, Instant b) {
        return a.isAfter(b) ? a : b;
    }

    public static Instant min(Instant a, Instant b) {
        return a.isBefore(b) ? a : b;
    }
}
