package com.j24.mock.store;

import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.ApiException;
import com.j24.mock.credit.CreditService;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Store Manager: onboarding a store. */
@Service
public class StoreService {

    public record Store(UUID storeId, String name, String ownerName, String phone, String address) {
    }

    private final JdbcClient jdbc;
    private final CreditService credits;

    public StoreService(JdbcClient jdbc, CreditService credits) {
        this.jdbc = jdbc;
        this.credits = credits;
    }

    /** A new store always starts with an empty wallet (0 available, 0 held). */
    @Transactional
    public UUID create(String name, String ownerName, String phone, String address) {
        UUID storeId = UUID.randomUUID();
        jdbc.sql("""
                        INSERT INTO store (id, owner_name, phone, name, address)
                        VALUES (:id, :ownerName, :phone, :name, :address)
                        """)
                .param("id", storeId)
                .param("ownerName", ownerName)
                .param("phone", phone)
                .param("name", name)
                .param("address", address)
                .update();
        credits.createWallet(storeId);
        return storeId;
    }

    public List<Store> list() {
        return jdbc.sql("SELECT id, name, owner_name, phone, address FROM store ORDER BY created_at")
                .query((rs, i) -> new Store(uuid(rs, "id"), rs.getString("name"), rs.getString("owner_name"),
                        rs.getString("phone"), rs.getString("address")))
                .list();
    }

    public void requireExists(UUID storeId) {
        boolean exists = jdbc.sql("SELECT EXISTS (SELECT 1 FROM store WHERE id = :id)")
                .param("id", storeId)
                .query(Boolean.class)
                .single();
        if (!exists) {
            throw ApiException.notFound("store");
        }
    }
}
