package com.j24.mock.credit;

import static com.j24.mock.common.Db.instant;
import static com.j24.mock.common.Db.uuid;

import com.j24.mock.common.ApiException;
import java.sql.Types;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Credit Manager: the only code that changes a wallet.
 * Every change updates `wallet` (the balance) and appends to `credit_transactions` (the statement)
 * in the same database transaction, so the two always agree.
 */
@Service
public class CreditService {

    private static final Logger log = LoggerFactory.getLogger(CreditService.class);

    public record Wallet(UUID storeId, long available, long held) {
    }

    public record CreditTransaction(long id, String type, long amount, UUID adId, Instant createdAt) {
    }

    private final JdbcClient jdbc;

    public CreditService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void createWallet(UUID storeId) {
        jdbc.sql("INSERT INTO wallet (store_id, available, held) VALUES (:storeId, 0, 0)")
                .param("storeId", storeId)
                .update();
    }

    public Wallet getWallet(UUID storeId) {
        return jdbc.sql("SELECT store_id, available, held FROM wallet WHERE store_id = :storeId")
                .param("storeId", storeId)
                .query((rs, i) -> new Wallet(uuid(rs, "store_id"), rs.getLong("available"), rs.getLong("held")))
                .optional()
                .orElseThrow(() -> ApiException.notFound("wallet"));
    }

    /**
     * Locks the store's wallet row until the surrounding transaction ends.
     * Every credit-changing flow calls this FIRST, so they all lock in the same order (no deadlocks)
     * and two publishes can never spend the same credits.
     */
    public Wallet lockWallet(UUID storeId) {
        return jdbc.sql("SELECT store_id, available, held FROM wallet WHERE store_id = :storeId FOR UPDATE")
                .param("storeId", storeId)
                .query((rs, i) -> new Wallet(uuid(rs, "store_id"), rs.getLong("available"), rs.getLong("held")))
                .optional()
                .orElseThrow(() -> ApiException.notFound("wallet"));
    }

    /** Mock gateway: the charge always succeeds synchronously. A real gateway needs a payment table + webhook. */
    @Transactional
    public Wallet purchase(UUID storeId, long credits) {
        if (credits <= 0) {
            throw ApiException.badRequest("credits must be positive");
        }
        lockWallet(storeId);
        String gatewayPaymentId = "mock_pay_" + UUID.randomUUID();
        log.info("Mock gateway charged store={} credits={} payment={}", storeId, credits, gatewayPaymentId);

        jdbc.sql("UPDATE wallet SET available = available + :credits WHERE store_id = :storeId")
                .param("credits", credits)
                .param("storeId", storeId)
                .update();
        record(storeId, "PURCHASE", credits, null);
        return getWallet(storeId);
    }

    /** Publish: move the ad's full cost from available to held. Caller must hold the wallet lock. */
    public void hold(UUID storeId, UUID adId, long amount) {
        int updated = jdbc.sql("""
                        UPDATE wallet SET available = available - :amount, held = held + :amount
                        WHERE store_id = :storeId AND available >= :amount
                        """)
                .param("amount", amount)
                .param("storeId", storeId)
                .update();
        if (updated == 0) {
            throw new ApiException(HttpStatus.PAYMENT_REQUIRED, "INSUFFICIENT_CREDITS", "not enough credits");
        }
        record(storeId, "HOLD", amount, adId);
    }

    /**
     * Settle part of a hold: `deducted` is J24's revenue, `released` goes back to available.
     * Caller must hold the wallet lock.
     */
    public void settle(UUID storeId, UUID adId, long deducted, long released) {
        jdbc.sql("""
                        UPDATE wallet SET held = held - :total, available = available + :released
                        WHERE store_id = :storeId
                        """)
                .param("total", deducted + released)
                .param("released", released)
                .param("storeId", storeId)
                .update();
        if (deducted > 0) {
            record(storeId, "DEDUCT", deducted, adId);
        }
        if (released > 0) {
            record(storeId, "RELEASE", released, adId);
        }
    }

    public List<CreditTransaction> transactions(UUID storeId) {
        return jdbc.sql("""
                        SELECT id, type, amount, ad_id, created_at FROM credit_transactions
                        WHERE store_id = :storeId ORDER BY id DESC
                        """)
                .param("storeId", storeId)
                .query((rs, i) -> new CreditTransaction(
                        rs.getLong("id"), rs.getString("type"), rs.getLong("amount"),
                        uuid(rs, "ad_id"), instant(rs, "created_at")))
                .list();
    }

    private void record(UUID storeId, String type, long amount, UUID adId) {
        jdbc.sql("""
                        INSERT INTO credit_transactions (store_id, type, amount, ad_id)
                        VALUES (:storeId, :type, :amount, :adId)
                        """)
                .param("storeId", storeId)
                .param("type", type)
                .param("amount", amount)
                .param("adId", adId, Types.OTHER) // nullable UUID: PURCHASE has no ad
                .update();
    }
}
