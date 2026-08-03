CREATE TABLE profiles (
    discord_user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    pronunciation TEXT,
    favorite_drink TEXT,
    dietary_notes TEXT,
    interests TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);