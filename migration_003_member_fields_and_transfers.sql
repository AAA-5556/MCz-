-- ============================================================================
-- migration_003_member_fields_and_transfers.sql
--
-- (1) Flexible member fields. Only first_name + last_name are mandatory
--     (enforced at the app layer); national_code, phone, extra_info optional.
--     `name` is kept as a display cache (first + ' ' + last) so existing read
--     queries keep working. national_code stays NOT NULL at the DB level, but
--     we store '' for "not provided" and use a PARTIAL unique index so only
--     real codes must be unique within an institute.
--
-- (2) transfer_requests: institute-initiated member-move requests that a
--     supervising level1_admin approves (assigning a destination) or rejects.
--
-- Attendance history integrity: attendance rows already store institute_id at
-- insert time, so a member's past rows keep the OLD institute after a transfer.
-- No change needed there — we just must never rewrite attendance.institute_id.
-- ============================================================================

ALTER TABLE members ADD COLUMN first_name TEXT;
ALTER TABLE members ADD COLUMN last_name TEXT;
ALTER TABLE members ADD COLUMN phone TEXT;
ALTER TABLE members ADD COLUMN extra_info TEXT;
ALTER TABLE members ADD COLUMN created_at TEXT;

-- Backfill existing rows: put the whole legacy name into first_name.
UPDATE members
  SET first_name = name,
      last_name  = COALESCE(last_name, ''),
      created_at = COALESCE(created_at, '2026-07-01T00:00:00.000Z')
  WHERE first_name IS NULL;

-- Replace the strict unique index with a partial one (only non-empty codes).
DROP INDEX IF EXISTS idx_members_institute_nc;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_nc_partial
  ON members (institute_id, national_code)
  WHERE national_code IS NOT NULL AND national_code <> '';

-- ---------------------------------------------------------------------------
-- transfer_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfer_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id           INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  from_institute_id   INTEGER NOT NULL REFERENCES institutes(id),
  target_institute_id INTEGER REFERENCES institutes(id),   -- suggested/confirmed destination
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
