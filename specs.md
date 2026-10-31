# J24 In-Store Screen Ads — Specs

Source of truth for this mock. It follows `NewPlan/MiniPlan.md`. Where the code needed a detail the plan
doesn't spell out, it is listed in [§8 Additions to the plan](#8-additions-to-the-plan).

---

## 1. Scope and assumptions

- Store owners (kirana stores, mini-marts) run ads on TVs inside their own store. The owner is the advertiser.
- Image ads only (image + headline).
- Each screen loops through **6 slots of 10 seconds** (one minute per loop). A booked ad plays **once a minute** on each screen it books.
- An ad runs in one continuous range `startTime → endTime` and plays for that whole range.
- Booking a slot blocks it for that range, so no other ad can use it. This is why screens can pre-fetch the next 3 days.
- **1 credit = ₹1 = 1 play.** Whole numbers only.
- All dates are store-local **IST** (Asia/Kolkata).
- One outlet per store (multi-outlet would need `store_id + outlet_id`).
- Payment gateway is **mocked**: buying credits succeeds instantly.

## 2. Services (one Spring Boot app, one package each)

| Service | Package | Owns | Does |
|---|---|---|---|
| Store Manager | `store` | `store` | Onboard a store (creates its empty wallet) |
| Screen Manager | `screen` | `screen`, `slot_booking` | Register screens, status, last seen, slot availability, book / free slots, health alerts |
| Ad Manager | `ad` | `ad`, `ad_status_history` | Availability preview, publish, pause, resume, cancel |
| Credit Manager | `credit` | `wallet`, `credit_transactions`, `ad_daily_billing` | Buy, hold, settle (charge what aired), release |
| Ad Server | `adserver` | writes `play_log` | Screen sync: receive play logs, return the 3-day playlist |

Publish touches Ad, Screen and Credit Manager in **one database transaction**, so it is all-or-nothing.

## 3. Database (PostgreSQL)

Schema: `backend/src/main/resources/schema.sql`.

| Table | Columns (key ones) | Rules |
|---|---|---|
| `store` | id, owner_name, phone, name, address | |
| `screen` | id (UUID, server-generated), store_id, name, placement_type, width_pixels, height_pixels, slots_per_loop = 6, slot_duration_seconds = 10, status, last_seen_at | placement: ENTRANCE / NEAR_CHECKOUT / AISLE / OTHER; status: ACTIVE / INACTIVE |
| `ad` | id, store_id, name, headline, image (bytes), image_content_type, start_time, end_time, status, price_per_play, total_cost, idempotency_key UNIQUE, created_at, updated_at | status: ACTIVE / PAUSED / CANCELLED; "ENDED" is derived (end_time passed) |
| `ad_status_history` | ad_id, status, changed_at | one row per status change |
| `slot_booking` | id, ad_id, screen_id, slot_index, start_time, end_time, active | index (screen_id, slot_index, start_time, end_time) |
| `wallet` | store_id PK, available, held | `CHECK available >= 0`, `CHECK held >= 0` |
| `credit_transactions` | id, store_id, type, amount, ad_id, created_at | append-only; type: PURCHASE / HOLD / DEDUCT / RELEASE; amount > 0; ad_id empty for PURCHASE |
| `ad_daily_billing` | id, ad_id, date, booked_plays, held, status, deducted, released, settled_at | UNIQUE (ad_id, date); `CHECK status = 'HELD' OR deducted + released = held` |
| `play_log` | play_id PK (UUID made on the screen), screen_id, ad_id, slot_index, played_at, received_at | PK makes a re-uploaded play count once |

**Wallet vs credit_transactions**: the wallet is the balance on a bank app (one row, updated in place);
`credit_transactions` is the bank statement (one row per change, never edited). Both are written in the same
transaction, so `available + held = purchases − deductions` always holds.

**Slot availability** on a screen for a new range: slots 0–5, minus slots held by an *active* booking whose
range overlaps (existing starts before the new one ends **and** ends after the new one starts).

## 4. Money rules

1. Credits come in only through a (mock) purchase.
2. **Publish holds the full cost** in the same transaction that books the slots. Not enough credits → `402`, nothing is created. A booked ad can never run out of credits halfway.
3. Cost = plays per slot × slots booked × price per play. Plays per slot = whole minutes in the range. A screen can hold several slots of the same ad. One `ad_daily_billing` row per IST day holds that day's share.
4. **Settlement** charges only plays that actually aired, per ad per day:
   - billable = for each screen, the plays it reported inside that day's window **while the ad was ACTIVE**, never more than it booked; then add up the screens.
   - charged (`DEDUCT`) = billable × price; returned (`RELEASE`) = the rest.
5. **Pause** moves no credits. The slot stays blocked. Skipped plays are returned at settlement.
6. **Cancel** frees the slots and returns every day that hasn't started yet right away. A day already running settles normally (plays before the cancel are charged).
7. Only settlement charges credits. Publish only holds; cancel only releases.

**When a day settles**: the job runs every minute. An ad-day is settled once its window has ended **and**
either every booked screen has synced after the window (so its plays are uploaded), or 72 hours have passed.
Plays uploaded after their day settled are stored but not billed.

## 5. Concurrency

| Risk | How it's handled |
|---|---|
| Two publishes, credits for one | Wallet row locked `FOR UPDATE` first; the second waits, sees the lower balance, gets `402`. DB `CHECK available >= 0` as backup. |
| Same slot booked twice | Chosen screens locked `FOR UPDATE` (sorted by id); free slots re-checked inside the transaction → `409 SLOT_TAKEN`. |
| Deadlocks | Every credit-changing flow locks in the same order: wallet → screens / billing rows. |
| Cancel racing settlement | Both lock the wallet first; billing rows move `HELD → SETTLED` only via `WHERE status = 'HELD'`. |
| Settlement on two servers | `FOR UPDATE SKIP LOCKED` on the billing row. |
| Double-click publish | Optional `Idempotency-Key` header, unique on `ad.idempotency_key`; a retry returns the first result. |
| Play log uploaded twice | `play_id` primary key + `ON CONFLICT DO NOTHING`. |
| Screen ID collisions | Server-generated UUIDs. |

## 6. APIs (`/api/v1`)

Errors always look like `{"code": "...", "message": "...", ...details}`.

### Stores and screens

**`POST /stores`** — onboard a store (wallet starts at 0 / 0)
```json
// request
{ "name": "Kirana store 1", "ownerName": "Ramesh Sharma", "phone": "9876543210", "address": "MG Road, Bengaluru" }
// 201
{ "storeId": "11e90463-ac46-402f-8e7b-44faf0d25788" }
```

**`GET /stores`** — list stores
```json
[{ "storeId": "11e9…", "name": "Kirana store 1", "ownerName": "Ramesh Sharma", "phone": "9876543210", "address": "MG Road, Bengaluru" }]
```

**`POST /stores/{storeId}/screens`** — add a TV
```json
// request (widthPixels / heightPixels optional)
{ "name": "Checkout TV", "placementType": "NEAR_CHECKOUT", "widthPixels": 1920, "heightPixels": 1080 }
// 201
{ "screenId": "97b1d497-b672-4bc7-a7c4-d7548f9d4bd2" }
```

**`GET /stores/{storeId}/screens`** — `online` = synced in the last 10 minutes
```json
[{ "screenId": "97b1…", "name": "Checkout TV", "placementType": "NEAR_CHECKOUT", "widthPixels": 1920,
   "heightPixels": 1080, "slotsPerLoop": 6, "slotDurationSeconds": 10, "status": "ACTIVE",
   "online": true, "lastSeenAt": "2026-10-31T09:44:30Z" }]
```

**`PATCH /screens/{screenId}`** — mark a broken / removed TV inactive
```json
{ "status": "INACTIVE" }
```

### Credits

**`POST /stores/{storeId}/credits/purchase`** — mock gateway, synchronous
```json
// request
{ "credits": 5000 }
// 200
{ "storeId": "11e9…", "available": 15000, "held": 0 }
```

**`GET /stores/{storeId}/wallet`** → `{ "storeId": "11e9…", "available": 9996, "held": 4 }`

**`GET /stores/{storeId}/wallet/transactions`** — newest first
```json
[{ "id": 3, "type": "DEDUCT", "amount": 4, "adId": "6046…", "createdAt": "2026-10-31T09:44:30Z" },
 { "id": 2, "type": "HOLD", "amount": 4, "adId": "6046…", "createdAt": "2026-10-31T09:38:41Z" },
 { "id": 1, "type": "PURCHASE", "amount": 10000, "adId": null, "createdAt": "2026-10-31T09:38:24Z" }]
```

### Ads

**`POST /ads/availability`** — preview free slots and cost (nothing is locked)
```json
// request
{ "storeId": "11e9…", "screenIds": ["e260…", "97b1…"],
  "startTime": "2026-11-01T03:30:00Z", "endTime": "2026-11-01T15:30:00Z" }
// 200
{ "screens": [{ "screenId": "e260…", "screenName": "Entrance TV", "freeSlots": [0, 1, 3, 4, 5] },
              { "screenId": "97b1…", "screenName": "Checkout TV", "freeSlots": [0, 1, 2, 3, 4, 5] }],
  "playsPerScreen": 720, "totalCost": 1440, "available": 9996, "missingCredits": 0 }
```

**`POST /ads`** — publish. Multipart: part `ad` (JSON below) + part `image` (file). Plain JSON (no image) is
also accepted. Optional header `Idempotency-Key`. `slotIndex` is optional: omitted → lowest free slot.
```json
// "ad" part
{ "storeId": "11e9…", "name": "Diwali sweets", "headline": "20% off on Kaju Katli",
  "startTime": "2026-11-01T03:30:00Z", "endTime": "2026-11-01T15:30:00Z",
  "screens": [{ "screenId": "e260…", "slotIndex": 2 }, { "screenId": "97b1…" }] }
// 201
{ "adId": "6046…", "totalCost": 1440,
  "bookings": [{ "screenId": "97b1…", "slotIndex": 0 }, { "screenId": "e260…", "slotIndex": 2 }] }
// 402
{ "code": "INSUFFICIENT_CREDITS", "message": "You need 4403 more credits", "totalCost": 14399, "available": 9996, "missingCredits": 4403 }
// 409
{ "code": "SLOT_TAKEN", "message": "slot 2 on Entrance TV was just booked, pick another", "screenId": "e260…", "freeSlots": [0, 1, 3, 4, 5] }
```

**`POST /ads/{adId}/pause`**, **`POST /ads/{adId}/resume`** → the ad summary (below). Wrong status → `409 INVALID_STATUS`.

**`POST /ads/{adId}/cancel`** → `{ "adId": "6046…", "status": "CANCELLED", "releasedCredits": 720 }`

**`GET /ads?storeId=`** — the owner's ads
```json
[{ "adId": "6046…", "name": "Diwali sweets", "headline": "20% off on Kaju Katli", "status": "ACTIVE",
   "startTime": "2026-11-01T03:30:00Z", "endTime": "2026-11-01T15:30:00Z", "totalCost": 1440,
   "hasImage": true, "createdAt": "2026-10-31T09:38:41Z" }]
```

**`GET /ads/{adId}`** — detail with what was charged per day
```json
{ "ad": { "...": "summary as above" }, "pricePerPlay": 1, "playsReceived": 1320,
  "screens": [{ "screenId": "e260…", "screenName": "Entrance TV", "slotIndex": 2, "active": true }],
  "dailyBilling": [{ "id": "1d96…", "date": "2026-11-01", "bookedPlays": 1440, "held": 1440,
                     "status": "SETTLED", "deducted": 1320, "released": 120, "settledAt": "2026-11-01T15:31:00Z" }] }
```

**`GET /ads/{adId}/image`** — image bytes (screens download once and cache)

### Ad Server (called by the SDK on each screen)

**`POST /screens/{screenId}/sync`** — every 5 minutes, on reconnect and on app start. Uploads up to 500 queued
play logs; always returns the full 3-day playlist. Every uploaded play is acknowledged (even a duplicate), so
the screen can drop it from its queue.
```json
// request
{ "playLogs": [{ "playId": "0b8e…", "adId": "6046…", "slotIndex": 2, "playedAt": "2026-11-01T03:30:20Z" }] }
// 200
{ "receivedPlayIds": ["0b8e…"], "serverTime": "2026-11-01T03:35:00Z",
  "playlist": { "validUntil": "2026-11-04T03:35:00Z", "slotsPerLoop": 6, "slotDurationSeconds": 10,
                "screenStatus": "ACTIVE",
                "items": [{ "adId": "6046…", "slotIndex": 2, "name": "Diwali sweets", "headline": "20% off on Kaju Katli",
                            "startTime": "2026-11-01T03:30:00Z", "endTime": "2026-11-01T15:30:00Z",
                            "imageUrl": "/api/v1/ads/6046…/image" }] } }
```

### J24 admin (demo helpers)

- **`POST /admin/settlement/run?skipGrace=false`** → `{ "settled": 1, "deducted": 4, "released": 0 }`. Runs settlement now. `skipGrace=true` doesn't wait for offline screens.
- **`GET /admin/alerts`** → `[{ "screenId": "…", "storeId": "…", "screenName": "Dairy Aisle TV", "reason": "not seen since …", "since": "…" }]`

## 7. Screen SDK (simulated on the Screens page)

- **Pull, never push.** The screen calls `/sync`; the server never calls the screen.
- **Cache.** Keeps the playlist, the queued play logs and the clock offset locally (localStorage in the
  simulation) and images in memory. A new playlist is swapped in only after its images are downloaded.
- **Play by clock.** Every 10 seconds: `slot = (seconds since IST midnight / 10) mod 6`, using server time
  (device clock + offset from the last sync). If an ACTIVE ad owns that slot now and its image is cached →
  show it and write a play log. Otherwise show J24 house content (no play log, nothing billed).
- **Offline.** Keep playing from cache and queueing logs; retry sync every 5 s; on reconnect upload
  oldest-first in batches of 500 until the queue is empty. Past `validUntil` (3 days) → house content only.
- **Screen health.** A job every minute alerts J24 admin once per outage for screens that are INACTIVE or
  haven't synced for 10 minutes; the alert clears when the screen syncs again.

## 8. Additions to the plan

Things the code needed that MiniPlan doesn't spell out:

| Addition | Why |
|---|---|
| `ad_status_history` table | Settlement must know if the ad was ACTIVE at each `played_at` (offline screens keep playing after a pause). |
| `ad.image_content_type`, `created_at`, `updated_at`; `ad_daily_billing.settled_at` | Serving the image correctly; showing when things happened. |
| Publish body has `screens: [{screenId, slotIndex?}]` | The owner picks a free slot per screen, or the server takes the lowest free one. |
| A day settles when **the ad's window for that day** ends | Same rule as "after the day ends" for full-day ads; lets short demo ads settle without waiting for midnight. |
| `GET /stores`, `/admin/settlement/run`, `/admin/alerts` | UI needs a store list; demo needs to trigger settlement and show J24 admin alerts. |
| Plain-JSON publish (no image) | Easy to try with curl. The UI always sends an image. |
| A start time in the past snaps to the current minute (more than 5 min in the past → 400); ads last 1 minute to 30 days | Never bill minutes already gone; keep billing rows bounded. |
| Ports 8090 (backend) and 5180 (frontend) | 8080 / 5173 were already in use on the dev machine. |
