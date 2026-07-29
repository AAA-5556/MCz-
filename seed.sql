-- ============================================================================
-- seed.sql — bootstrap the first (root) account.
-- Run AFTER schema.sql:
--   wrangler d1 execute attendance-db --file=./seed.sql
--
-- Credentials (change the password after first login):
--   username: root
--   password: D2UkmB27kt4zbCDsHWmd
--
-- The password_hash below is PBKDF2-SHA256 (100k iterations) of that password,
-- in the same pbkdf2$sha256$iter$salt$hash format the API verifies against.
-- root is not tied to any institute, so institute_id is NULL.
-- ============================================================================

INSERT INTO users (username, password_hash, role, institute_id)
VALUES (
  'root',
  'pbkdf2$sha256$100000$yZMW0+evrwkCsZtd2u0IYA==$ppQOPMXrGCxodGgOrwIT3ivMPWfQziqbVor5ww7gMsE=',
  'root',
  NULL
);
