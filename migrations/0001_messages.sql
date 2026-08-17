-- Contact messages. The row is the source of truth; the notification email is
-- best-effort, so nothing here depends on mail having been delivered.
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  company    TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  country    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  handled_at TEXT
);

-- Reading the inbox is always newest-first.
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at DESC);
-- Looking up everything one person has ever sent.
CREATE INDEX IF NOT EXISTS idx_messages_email ON messages (email);
