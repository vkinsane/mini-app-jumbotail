-- J24 in-store screen ads. Runs on every start; every statement is idempotent.

CREATE TABLE IF NOT EXISTS store (
    id          UUID PRIMARY KEY,
    owner_name  TEXT NOT NULL,
    phone       TEXT,
    name        TEXT NOT NULL,
    address     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS screen (
    id                    UUID PRIMARY KEY,
    store_id              UUID NOT NULL REFERENCES store (id),
    name                  TEXT NOT NULL,
    placement_type        TEXT NOT NULL CHECK (placement_type IN ('ENTRANCE', 'NEAR_CHECKOUT', 'AISLE', 'OTHER')),
    width_pixels          INT,
    height_pixels         INT,
    slots_per_loop        INT NOT NULL DEFAULT 6,
    slot_duration_seconds INT NOT NULL DEFAULT 10,
    status                TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    last_seen_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_screen_store ON screen (store_id);

CREATE TABLE IF NOT EXISTS ad (
    id                 UUID PRIMARY KEY,
    store_id           UUID NOT NULL REFERENCES store (id),
    name               TEXT NOT NULL,
    headline           TEXT NOT NULL,
    image              BYTEA,
    image_content_type TEXT,
    start_time         TIMESTAMPTZ NOT NULL,
    end_time           TIMESTAMPTZ NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED')),
    price_per_play     BIGINT NOT NULL,
    total_cost         BIGINT NOT NULL,
    idempotency_key    TEXT UNIQUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_ad_store_status ON ad (store_id, status);

-- Every status change, so settlement can tell whether the ad was ACTIVE when a play happened.
CREATE TABLE IF NOT EXISTS ad_status_history (
    id         BIGSERIAL PRIMARY KEY,
    ad_id      UUID NOT NULL REFERENCES ad (id),
    status     TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_status_history ON ad_status_history (ad_id, changed_at);

CREATE TABLE IF NOT EXISTS slot_booking (
    id         UUID PRIMARY KEY,
    ad_id      UUID NOT NULL REFERENCES ad (id),
    screen_id  UUID NOT NULL REFERENCES screen (id),
    slot_index INT NOT NULL CHECK (slot_index >= 0),
    start_time TIMESTAMPTZ NOT NULL,
    end_time   TIMESTAMPTZ NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_slot_booking_availability ON slot_booking (screen_id, slot_index, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_slot_booking_ad ON slot_booking (ad_id);

CREATE TABLE IF NOT EXISTS wallet (
    store_id  UUID PRIMARY KEY REFERENCES store (id),
    available BIGINT NOT NULL DEFAULT 0 CHECK (available >= 0),
    held      BIGINT NOT NULL DEFAULT 0 CHECK (held >= 0)
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id         BIGSERIAL PRIMARY KEY,
    store_id   UUID NOT NULL REFERENCES store (id),
    type       TEXT NOT NULL CHECK (type IN ('PURCHASE', 'HOLD', 'DEDUCT', 'RELEASE')),
    amount     BIGINT NOT NULL CHECK (amount > 0),
    ad_id      UUID REFERENCES ad (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_store ON credit_transactions (store_id, created_at);

CREATE TABLE IF NOT EXISTS ad_daily_billing (
    id           UUID PRIMARY KEY,
    ad_id        UUID NOT NULL REFERENCES ad (id),
    date         DATE NOT NULL,
    booked_plays INT NOT NULL,
    held         BIGINT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('HELD', 'SETTLED')),
    deducted     BIGINT NOT NULL DEFAULT 0,
    released     BIGINT NOT NULL DEFAULT 0,
    settled_at   TIMESTAMPTZ,
    UNIQUE (ad_id, date),
    CHECK (status = 'HELD' OR deducted + released = held)
);
CREATE INDEX IF NOT EXISTS idx_ad_daily_billing_status ON ad_daily_billing (status, date);

CREATE TABLE IF NOT EXISTS play_log (
    play_id     UUID PRIMARY KEY,
    screen_id   UUID NOT NULL REFERENCES screen (id),
    ad_id       UUID NOT NULL REFERENCES ad (id),
    slot_index  INT NOT NULL,
    played_at   TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_play_log_billing ON play_log (ad_id, screen_id, played_at);
