-- ============================================================================
-- Attendance Tracking System — Cloudflare D1 (SQLite) schema
-- Run with:  wrangler d1 execute <DB_NAME> --file=./schema.sql
-- ============================================================================

-- SQLite does not have a native ENUM type. We emulate the enums described in
-- the spec with CHECK constraints so bad values are rejected at the DB layer.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- institutes
--   created_by    : users.id of the admin who created it (immutable owner).
--   supervisor_id : users.id of the admin currently responsible for it.
--                   Defaults to created_by; a root/mid_admin can reassign it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institutes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  supervisor_id  INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_institutes_supervisor ON institutes (supervisor_id);
CREATE INDEX IF NOT EXISTS idx_institutes_created_by ON institutes (created_by);

-- ---------------------------------------------------------------------------
-- users
--   role: 'root' | 'mid_admin' | 'level1_admin' | 'institute'
--   institute_id  : nullable — only 'institute' users are tied to one.
--   supervisor_id : for a 'level1_admin', the mid_admin who manages them.
--                   (null for root/mid_admin/institute)
--   display_name  : optional human-friendly (Persian) name shown in the UI.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL
                   CHECK (role IN ('root', 'mid_admin', 'level1_admin', 'institute')),
  institute_id   INTEGER
                   REFERENCES institutes(id) ON DELETE SET NULL,
  supervisor_id  INTEGER
                   REFERENCES users(id) ON DELETE SET NULL,
  display_name   TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_supervisor ON users (supervisor_id);

-- ---------------------------------------------------------------------------
-- members  (people whose attendance is tracked, each belongs to an institute)
--   Only first_name + last_name are mandatory (enforced in the API).
--   `name` is a display cache = first_name + ' ' + last_name.
--   national_code/phone/extra_info are optional; created_at is an ISO string.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  institute_id   INTEGER NOT NULL
                   REFERENCES institutes(id) ON DELETE CASCADE,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL DEFAULT '',
  name           TEXT,                 -- display cache
  national_code  TEXT,                 -- optional ('' when not provided)
  phone          TEXT,
  extra_info     TEXT,
  created_at     TEXT
);

-- Only real (non-empty) national codes must be unique within an institute.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_nc_partial
  ON members (institute_id, national_code)
  WHERE national_code IS NOT NULL AND national_code <> '';

-- ---------------------------------------------------------------------------
-- transfer_requests  (institute-initiated member moves, approved by level1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfer_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id           INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  from_institute_id   INTEGER NOT NULL REFERENCES institutes(id),
  target_institute_id INTEGER REFERENCES institutes(id),
  requested_by        INTEGER REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  note                TEXT,
  created_at          TEXT NOT NULL,
  resolved_by         INTEGER REFERENCES users(id),
  resolved_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_from ON transfer_requests (from_institute_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_status ON transfer_requests (status);

-- ---------------------------------------------------------------------------
-- attendance
--   date is stored as an ISO 'YYYY-MM-DD' string (Asia/Tehran calendar day).
--   status: 'present' | 'absent'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  institute_id  INTEGER NOT NULL
                  REFERENCES institutes(id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL
                  REFERENCES members(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,                       -- 'YYYY-MM-DD'
  status        TEXT NOT NULL
                  CHECK (status IN ('present', 'absent')),

  -- One attendance row per member per day. This is what makes the UPSERT
  -- (ON CONFLICT) in POST /api/attendance work.
  UNIQUE (member_id, date)
);

-- Fast lookups for GET /api/attendance?date=... scoped by institute,
-- and for the history-deletion range scan (institute_id + date).
CREATE INDEX IF NOT EXISTS idx_attendance_institute_date
  ON attendance (institute_id, date);
