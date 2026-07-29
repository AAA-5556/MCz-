-- seed_isolation.sql — a second, independent management chain for isolation tests.
-- midadmin2 -> level1admin2 -> "آموزشگاه دال". midadmin must NOT see this.

INSERT INTO users (username, password_hash, role) VALUES
  ('midadmin2', 'pbkdf2$sha256$100000$s0WCH9J9a8Lc/8/qSJdGbQ==$yJvFMWrjEWufEnIuiHv0I4+jBKW1yyoAP4TjYC1nKJ4=', 'mid_admin');

INSERT INTO users (username, password_hash, role, supervisor_id) VALUES
  ('level1admin2', 'pbkdf2$sha256$100000$9dBBQ/Uhqjg2SOsyvO4ZUw==$3ancPGWMO3ibwCGZm4j46+jezsZ5Lv4kb3CN054Wdeo=', 'level1_admin', (SELECT id FROM users WHERE username='midadmin2'));

INSERT INTO institutes (name, created_by, supervisor_id) VALUES
  ('آموزشگاه دال', (SELECT id FROM users WHERE username='level1admin2'), (SELECT id FROM users WHERE username='level1admin2'));

INSERT INTO users (username, password_hash, role, institute_id) VALUES
  ('inst_dal', 'pbkdf2$sha256$100000$UxhHtGDTNGGCgJPaeBosJA==$/D4WBppi+nYkUaCdJx5LU1j1NcdrlJXiiJBEg6+ZrxM=', 'institute', (SELECT id FROM institutes WHERE name='آموزشگاه دال'));

INSERT INTO members (institute_id, name, national_code) VALUES
  ((SELECT id FROM institutes WHERE name='آموزشگاه دال'), 'سارا موسوی', '0089012345'),
  ((SELECT id FROM institutes WHERE name='آموزشگاه دال'), 'امیر تهرانی', '0090123456');
