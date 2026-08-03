CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    global_name TEXT,
    avatar TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_oauth_states_expires_at
ON oauth_states(expires_at);

CREATE INDEX idx_sessions_discord_user_id
ON sessions(discord_user_id);

CREATE INDEX idx_sessions_expires_at
ON sessions(expires_at);