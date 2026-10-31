package com.j24.mock.common;

import com.j24.mock.credit.CreditService;
import com.j24.mock.screen.ScreenService;
import com.j24.mock.store.StoreService;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** First start only: two stores with 5 screens and 10,000 credits each, so the UI has something to show. */
@Component
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    private final J24Properties properties;
    private final StoreService stores;
    private final ScreenService screens;
    private final CreditService credits;

    public DemoDataSeeder(J24Properties properties, StoreService stores, ScreenService screens,
                          CreditService credits) {
        this.properties = properties;
        this.stores = stores;
        this.screens = screens;
        this.credits = credits;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!properties.seedDemoData() || !stores.list().isEmpty()) {
            return;
        }
        seedStore("Kirana store 1", "Ramesh Sharma", "9876543210", "MG Road, Bengaluru");
        seedStore("Kirana store 2", "Suresh Patel", "9876500000", "Indiranagar, Bengaluru");
    }

    private void seedStore(String name, String ownerName, String phone, String address) {
        UUID storeId = stores.create(name, ownerName, phone, address);
        List.of(
                new String[] {"Entrance TV", "ENTRANCE"},
                new String[] {"Checkout TV", "NEAR_CHECKOUT"},
                new String[] {"Snacks Aisle TV", "AISLE"},
                new String[] {"Dairy Aisle TV", "AISLE"},
                new String[] {"Billing Counter TV", "NEAR_CHECKOUT"}
        ).forEach(screen -> screens.create(storeId, screen[0], screen[1], 1920, 1080));
        credits.purchase(storeId, 10_000);
        log.info("Seeded demo store '{}' ({}) with 5 screens and 10,000 credits", name, storeId);
    }
}
