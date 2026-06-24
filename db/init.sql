-- Schema + seed for the Elango travel engine.
-- Mounted into the Postgres container at /docker-entrypoint-initdb.d so it runs
-- automatically the first time the data volume is initialised. Safe to re-run
-- thanks to IF NOT EXISTS guards and the seed's emptiness check.

CREATE TABLE IF NOT EXISTS bot_state (
    id SERIAL PRIMARY KEY,
    lat FLOAT NOT NULL,
    lon FLOAT NOT NULL,
    current_city VARCHAR(255) NOT NULL,
    landmark_name VARCHAR(255),
    story TEXT,
    energy INT DEFAULT 100 CHECK (energy >= 0 AND energy <= 100),
    wallet INT DEFAULT 2000 CHECK (wallet >= 0),
    -- Enrichment + self-exploration fields
    image_url TEXT,
    weather VARCHAR(120),
    time_of_day VARCHAR(20),
    activity VARCHAR(40),
    target_name VARCHAR(255),
    target_lat FLOAT,
    target_lon FLOAT,
    trip_distance_km FLOAT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Idempotent upgrades for databases created before these columns existed.
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS weather VARCHAR(120);
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(20);
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS activity VARCHAR(40);
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS target_name VARCHAR(255);
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS target_lat FLOAT;
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS target_lon FLOAT;
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS trip_distance_km FLOAT DEFAULT 0;
-- Speculative next-tick story cache (pre-generated during the idle window).
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS pending_story TEXT;
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS pending_lat FLOAT;
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS pending_lon FLOAT;
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS llm_cache_hit BOOLEAN;
-- Agent loop (spec 01/03): the Director's mood + the emergent beat that fired,
-- recorded on each episode so memory (spec 02) can recall and call back to it.
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS mood VARCHAR(40);
ALTER TABLE bot_state ADD COLUMN IF NOT EXISTS beat VARCHAR(40);

CREATE TABLE IF NOT EXISTS active_votes (
    id SERIAL PRIMARY KEY,
    option_a_title VARCHAR(255) NOT NULL,
    option_a_lat FLOAT NOT NULL,
    option_a_lon FLOAT NOT NULL,
    option_b_title VARCHAR(255) NOT NULL,
    option_b_lat FLOAT NOT NULL,
    option_b_lon FLOAT NOT NULL,
    option_a_count INT DEFAULT 0,
    option_b_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    minimum_votes INT DEFAULT 3,
    resolved_by VARCHAR(20),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
ALTER TABLE active_votes ADD COLUMN IF NOT EXISTS minimum_votes INT DEFAULT 3;
ALTER TABLE active_votes ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(20);

-- One ballot per browser session per poll → prevents anonymous vote-stuffing.
CREATE TABLE IF NOT EXISTS vote_ballots (
    vote_id INT NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    option CHAR(1) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (vote_id, session_id)
);

-- Shareable "trophy" cards for funded bus arrivals — the one viral surface.
CREATE TABLE IF NOT EXISTS milestone_cards (
    id SERIAL PRIMARY KEY,
    handle VARCHAR(100) NOT NULL,
    city VARCHAR(255) NOT NULL,
    landmark VARCHAR(255),
    day INT,
    image_url TEXT,
    session_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_milestone_created ON milestone_cards (created_at DESC);

CREATE TABLE IF NOT EXISTS live_chat (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    reply TEXT,
    reply_pending BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE live_chat ADD COLUMN IF NOT EXISTS reply_pending BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_live_chat_username ON live_chat (lower(username));

-- Helpful indexes for the "newest row" / "active poll" lookups the app makes.
CREATE INDEX IF NOT EXISTS idx_bot_state_id_desc ON bot_state (id DESC);
CREATE INDEX IF NOT EXISTS idx_live_chat_id_desc ON live_chat (id DESC);
CREATE INDEX IF NOT EXISTS idx_active_votes_active ON active_votes (is_active);

-- Per-viewer support actions (coffees, bus funds, votes) so Elango can
-- recognise and thank returning followers.
CREATE TABLE IF NOT EXISTS supporters (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    action VARCHAR(20) NOT NULL,
    session_id VARCHAR(64),
    paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE supporters ADD COLUMN IF NOT EXISTS session_id VARCHAR(64);
ALTER TABLE supporters ADD COLUMN IF NOT EXISTS paid BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_supporters_username ON supporters (lower(username));

-- Lightweight presence heartbeat for the live viewer count.
CREATE TABLE IF NOT EXISTS presence (
    client_id VARCHAR(64) PRIMARY KEY,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Web Push subscriptions for closed-tab notifications.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- "Make it real" demand + email capture, before any real payment exists. Lets
-- us gauge willingness-to-pay and build a re-engagement list with zero charge.
CREATE TABLE IF NOT EXISTS support_intents (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(64),
    username VARCHAR(100),
    kind VARCHAR(20),
    email VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Passive daily-active proxy: one row per client per calendar day, written from
-- the presence heartbeat. Cheapest possible retention signal (Day-2 return).
CREATE TABLE IF NOT EXISTS daily_active (
    session_id VARCHAR(64) NOT NULL,
    day DATE NOT NULL,
    PRIMARY KEY (session_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_active_day ON daily_active (day);

-- Speeds up the presence stale-row prune now that it runs probabilistically.
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence (last_seen);

-- ---- Memory layer (Architecture Spec 02) --------------------------------
-- The nightly "sleep pass" consolidates beat-tagged episodes into these:
--   semantic_facts — distilled knowledge about places, himself, people
--   people         — one evolving relationship profile per viewer
--   diary_entries  — the day's recap (shareable, and a re-engagement hook)
CREATE TABLE IF NOT EXISTS semantic_facts (
    id SERIAL PRIMARY KEY,
    subject VARCHAR(20) NOT NULL,
    subject_key VARCHAR(120),
    text TEXT NOT NULL,
    salience REAL DEFAULT 0.5,
    source_to INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_semantic_subject ON semantic_facts (subject, subject_key);

CREATE TABLE IF NOT EXISTS people (
    handle VARCHAR(100) PRIMARY KEY,
    session_id VARCHAR(64),
    bond VARCHAR(20) DEFAULT 'newcomer',
    summary TEXT,
    deeds JSONB,
    first_seen TIMESTAMP WITH TIME ZONE,
    last_seen TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diary_entries (
    id SERIAL PRIMARY KEY,
    day DATE,
    text TEXT NOT NULL,
    source_to INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Elango at Chennai's Marina Beach, but only if the journey is empty.
INSERT INTO bot_state (lat, lon, current_city, landmark_name, story, energy, wallet)
SELECT
    13.0827, 80.2707, 'Chennai', 'Marina Beach',
    'Elango just laced up his boots on the breezy Marina sands in Chennai, the smell of fresh sundal drifting over from a vendor''s cart. The Tamil Nadu road trip begins!',
    100, 2000
WHERE NOT EXISTS (SELECT 1 FROM bot_state);
