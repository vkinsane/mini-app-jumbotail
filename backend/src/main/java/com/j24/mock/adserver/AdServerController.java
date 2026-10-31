package com.j24.mock.adserver;

import com.j24.mock.adserver.AdServerService.PlayLog;
import com.j24.mock.adserver.AdServerService.SyncResult;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/screens")
public class AdServerController {

    public record SyncRequest(List<PlayLog> playLogs) {
    }

    private final AdServerService adServer;

    public AdServerController(AdServerService adServer) {
        this.adServer = adServer;
    }

    /** Called by the SDK on each screen every 5 minutes, on reconnect and on app start. */
    @PostMapping("/{screenId}/sync")
    public SyncResult sync(@PathVariable UUID screenId, @RequestBody(required = false) SyncRequest request) {
        return adServer.sync(screenId, request == null ? List.of() : request.playLogs());
    }
}
