package com.j24.mock.credit;

import com.j24.mock.credit.CreditService.CreditTransaction;
import com.j24.mock.credit.CreditService.Wallet;
import com.j24.mock.credit.SettlementService.SettlementResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class CreditController {

    public record PurchaseRequest(@Min(1) @Max(10_000_000) long credits) {
    }

    private final CreditService credits;
    private final SettlementService settlement;

    public CreditController(CreditService credits, SettlementService settlement) {
        this.credits = credits;
        this.settlement = settlement;
    }

    @PostMapping("/stores/{storeId}/credits/purchase")
    public Wallet purchase(@PathVariable UUID storeId, @Valid @RequestBody PurchaseRequest request) {
        return credits.purchase(storeId, request.credits());
    }

    @GetMapping("/stores/{storeId}/wallet")
    public Wallet wallet(@PathVariable UUID storeId) {
        return credits.getWallet(storeId);
    }

    @GetMapping("/stores/{storeId}/wallet/transactions")
    public List<CreditTransaction> transactions(@PathVariable UUID storeId) {
        return credits.transactions(storeId);
    }

    /** Demo helper: run the settlement job now instead of waiting for the next minute. */
    @PostMapping("/ops/settlement/run")
    public SettlementResult runSettlement(@RequestParam(defaultValue = "false") boolean skipGrace) {
        return settlement.run(skipGrace);
    }
}
