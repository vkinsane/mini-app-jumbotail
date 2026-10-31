package com.j24.mock.store;

import com.j24.mock.store.StoreService.Store;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/stores")
public class StoreController {

    public record CreateStoreRequest(@NotBlank String name, @NotBlank String ownerName, String phone, String address) {
    }

    private final StoreService stores;

    public StoreController(StoreService stores) {
        this.stores = stores;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, UUID> create(@Valid @RequestBody CreateStoreRequest request) {
        UUID storeId = stores.create(request.name(), request.ownerName(), request.phone(), request.address());
        return Map.of("storeId", storeId);
    }

    @GetMapping
    public List<Store> list() {
        return stores.list();
    }
}
