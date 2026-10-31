package com.j24.mock.screen;

import com.j24.mock.common.J24Properties;
import com.j24.mock.screen.ScreenHealthJob.Alert;
import com.j24.mock.screen.ScreenService.Screen;
import com.j24.mock.store.StoreService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ScreenController {

    public record CreateScreenRequest(@NotBlank String name, @NotBlank String placementType,
                                      Integer widthPixels, Integer heightPixels) {
    }

    public record UpdateScreenRequest(@NotBlank String status) {
    }

    /** `online` = synced within the last 10 minutes. */
    public record ScreenView(UUID screenId, String name, String placementType, Integer widthPixels,
                             Integer heightPixels, int slotsPerLoop, int slotDurationSeconds, String status,
                             boolean online, Instant lastSeenAt) {
    }

    private final ScreenService screens;
    private final StoreService stores;
    private final ScreenHealthJob health;
    private final J24Properties properties;

    public ScreenController(ScreenService screens, StoreService stores, ScreenHealthJob health,
                            J24Properties properties) {
        this.screens = screens;
        this.stores = stores;
        this.health = health;
        this.properties = properties;
    }

    @PostMapping("/stores/{storeId}/screens")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, UUID> create(@PathVariable UUID storeId, @Valid @RequestBody CreateScreenRequest request) {
        stores.requireExists(storeId);
        UUID screenId = screens.create(storeId, request.name(), request.placementType(),
                request.widthPixels(), request.heightPixels());
        return Map.of("screenId", screenId);
    }

    @GetMapping("/stores/{storeId}/screens")
    public List<ScreenView> list(@PathVariable UUID storeId) {
        stores.requireExists(storeId);
        return screens.listByStore(storeId).stream().map(this::view).toList();
    }

    @PatchMapping("/screens/{screenId}")
    public ScreenView update(@PathVariable UUID screenId, @Valid @RequestBody UpdateScreenRequest request) {
        return view(screens.setStatus(screenId, request.status()));
    }

    /** What J24 ops sees: screens that are INACTIVE or offline for more than 10 minutes. */
    @GetMapping("/ops/alerts")
    public List<Alert> alerts() {
        return health.openAlerts();
    }

    private ScreenView view(Screen screen) {
        Instant onlineCutoff = Instant.now().minus(Duration.ofMinutes(properties.screenOfflineAfterMinutes()));
        boolean online = screen.lastSeenAt() != null && screen.lastSeenAt().isAfter(onlineCutoff);
        return new ScreenView(screen.screenId(), screen.name(), screen.placementType(), screen.widthPixels(),
                screen.heightPixels(), screen.slotsPerLoop(), screen.slotDurationSeconds(), screen.status(),
                online, screen.lastSeenAt());
    }
}
