-- ============================================================================
-- migration_004_user_display_name.sql
-- Adds users.display_name: an optional human-friendly (Persian) name shown in
-- the UI and in the supervisor widget, e.g. 'علی رضایی' or 'دبستان نبوت'.
-- ============================================================================

ALTER TABLE users ADD COLUMN display_name TEXT;

-- Backfill: institute accounts get their institute's name; others get username.
UPDATE users
  SET display_name = (SELECT i.name FROM institutes i WHERE i.id = users.institute_id)
  WHERE role = 'institute' AND display_name IS NULL;

UPDATE users
  SET display_name = username
  WHERE display_name IS NULL;
