package com.j24.mock.common;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "j24")
public record J24Properties(
        boolean seedDemoData,
        int settlementGraceHours,
        int screenOfflineAfterMinutes,
        int playlistDays) {
}
