-- ============================================================================
-- migration_002_user_supervisor.sql
-- New hierarchy: a level1_admin is supervised by a mid_admin.
--   users.supervisor_id -> for a level1_admin, the mid_admin who manages them.
--                          (null for root/mid_admin; institutes use institute_id)
--
-- Also realigns the existing sample data to the new model:
--   - level1admin is now supervised by midadmin
--   - all institutes are supervised DIRECTLY by level1admin (not mid_admin),
--     so midadmin sees them INDIRECTLY through level1admin.
-- ============================================================================

ALTER TABLE users ADD COLUMN supervisor_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_users_supervisor ON users (supervisor_id);

-- --- realign sample data ---
UPDATE users
  SET supervisor_id = (SELECT id FROM users WHERE username = 'midadmin')
  WHERE username = 'level1admin';

UPDATE institutes
  SET supervisor_id = (SELECT id FROM users WHERE username = 'level1admin'),
      created_by    = (SELECT id FROM users WHERE username = 'level1admin');
