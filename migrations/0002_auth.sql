-- Opaque random IDs allow immediate logout revocation; signed tokens never enter D1.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);

-- HMAC-derived IP buckets avoid persisting raw client addresses.
CREATE TABLE IF NOT EXISTS auth_login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_login_attempts_expiry ON auth_login_attempts(expires_at);
