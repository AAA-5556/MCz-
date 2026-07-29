-- ============================================================================
-- migration_001_supervision.sql
-- Adds the "supervision" model to institutes:
--   created_by     -> the admin (users.id) who created the institute (immutable)
--   supervisor_id  -> the admin currently responsible for / able to view it.
--                     Defaults to the creator; a root/mid_admin may reassign it.
--
-- Safe to run once on the existing remote DB (institutes table is empty).
-- Run: wrangler d1 execute attendance-db --remote --file=./migration_001_supervision.sql
-- ============================================================================

ALTER TABLE institutes ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE institutes ADD COLUMN supervisor_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_institutes_supervisor ON institutes (supervisor_id);
CREATE INDEX IF NOT EXISTS idx_institutes_created_by ON institutes (created_by);
