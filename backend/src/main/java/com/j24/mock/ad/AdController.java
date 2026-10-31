package com.j24.mock.ad;

import com.j24.mock.ad.AdService.Ad;
import com.j24.mock.ad.AdService.AdDraft;
import com.j24.mock.ad.AdService.Availability;
import com.j24.mock.ad.AdService.BookingView;
import com.j24.mock.ad.AdService.Image;
import com.j24.mock.ad.AdService.Published;
import com.j24.mock.ad.AdService.ScreenChoice;
import com.j24.mock.common.ApiException;
import com.j24.mock.credit.BillingService.BillingRow;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/ads")
public class AdController {

    public record AvailabilityRequest(@NotNull UUID storeId, @NotEmpty List<UUID> screenIds,
                                      @NotNull Instant startTime, @NotNull Instant endTime) {
    }

    public record PublishRequest(@NotNull UUID storeId, @NotBlank String name, @NotBlank String headline,
                                 @NotNull Instant startTime, @NotNull Instant endTime,
                                 @NotEmpty List<ScreenChoice> screens) {

        AdDraft toDraft() {
            return new AdDraft(storeId, name, headline, startTime, endTime, screens);
        }
    }

    public record AdSummary(UUID adId, String name, String headline, String status, Instant startTime,
                            Instant endTime, long totalCost, boolean hasImage, Instant createdAt) {
    }

    public record AdDetail(AdSummary ad, long pricePerPlay, long playsReceived, List<BookingView> screens,
                           List<BillingRow> dailyBilling) {
    }

    private final AdService ads;

    public AdController(AdService ads) {
        this.ads = ads;
    }

    @PostMapping("/availability")
    public Availability availability(@Valid @RequestBody AvailabilityRequest request) {
        return ads.availability(request.storeId(), request.screenIds(), request.startTime(), request.endTime());
    }

    /** Publish with an image: multipart with an "ad" JSON part and an "image" file part. */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Published publishWithImage(@Valid @RequestPart("ad") PublishRequest request,
                                      @RequestPart(value = "image", required = false) MultipartFile image,
                                      @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        return publish(request, toImage(image), key);
    }

    /** Publish without an image (plain JSON) — handy for curl; the screen shows the headline instead. */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Published publishJson(@Valid @RequestBody PublishRequest request,
                                 @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        return publish(request, null, key);
    }

    @PostMapping("/{adId}/pause")
    public AdSummary pause(@PathVariable UUID adId) {
        return summary(ads.pause(adId));
    }

    @PostMapping("/{adId}/resume")
    public AdSummary resume(@PathVariable UUID adId) {
        return summary(ads.resume(adId));
    }

    @PostMapping("/{adId}/cancel")
    public Map<String, Object> cancel(@PathVariable UUID adId) {
        return ads.cancel(adId);
    }

    @GetMapping
    public List<AdSummary> list(@RequestParam UUID storeId) {
        return ads.list(storeId).stream().map(this::summary).toList();
    }

    @GetMapping("/{adId}")
    public AdDetail detail(@PathVariable UUID adId) {
        Ad ad = ads.get(adId);
        return new AdDetail(summary(ad), ad.pricePerPlay(), ads.playCount(adId), ads.bookings(adId),
                ads.billingRows(adId));
    }

    /** Screens download each image once and cache it; the bytes of an ad never change. */
    @GetMapping("/{adId}/image")
    public ResponseEntity<byte[]> image(@PathVariable UUID adId) {
        Image image = ads.image(adId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(7)))
                .body(image.bytes());
    }

    private Published publish(PublishRequest request, Image image, String key) {
        try {
            return ads.publish(request.toDraft(), image, key);
        } catch (DuplicateKeyException e) {
            // Same Idempotency-Key raced in twice: the other request won, return its result.
            return ads.publish(request.toDraft(), image, key);
        }
    }

    private static Image toImage(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return null;
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            throw ApiException.badRequest("image must be an image file");
        }
        try {
            return new Image(file.getBytes(), contentType);
        } catch (IOException e) {
            throw ApiException.badRequest("could not read the image");
        }
    }

    private AdSummary summary(Ad ad) {
        return new AdSummary(ad.adId(), ad.name(), ad.headline(), ad.displayStatus(Instant.now()), ad.startTime(),
                ad.endTime(), ad.totalCost(), ad.hasImage(), ad.createdAt());
    }
}
