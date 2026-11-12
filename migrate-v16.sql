-- v16 (additive): public username + public/private album.
-- Existing users keep username NULL and a private album (album_public = 0). No existing row is modified.
ALTER TABLE users ADD COLUMN username TEXT NULL;
ALTER TABLE users ADD COLUMN album_public INTEGER NOT NULL DEFAULT 0;
-- Case-insensitive uniqueness (usernames are stored lower-case anyway); NULLs are not indexed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lc ON users (lower(username)) WHERE username IS NOT NULL;
