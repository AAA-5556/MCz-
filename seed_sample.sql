-- seed_sample.sql — realistic test data. Assumes a clean DB (only root exists).

-- 1) Admin accounts
INSERT INTO users (username, password_hash, role) VALUES
  ('midadmin', 'pbkdf2$sha256$100000$kATlCCX0ULsAQ0M1Bf+mCg==$oq0wB/8atI4ZNcG9wECVRkFtnCPynd5JK8njVSJzi3k=', 'mid_admin'),
  ('level1admin', 'pbkdf2$sha256$100000$LaLjgtdalkrgErM0v69hKw==$LxXlTTZCyOfIJaidp8BBA3Olcq9PGts17VBs47clLH0=', 'level1_admin');

-- 2) Institutes (two supervised by midadmin, one by level1admin)
INSERT INTO institutes (name, created_by, supervisor_id) VALUES
  ('دبستان الف', (SELECT id FROM users WHERE username='midadmin'),    (SELECT id FROM users WHERE username='midadmin')),
  ('دبستان ب',  (SELECT id FROM users WHERE username='midadmin'),    (SELECT id FROM users WHERE username='midadmin')),
  ('هنرستان ج', (SELECT id FROM users WHERE username='level1admin'), (SELECT id FROM users WHERE username='level1admin'));

-- 3) Institute login accounts (one per institute)
INSERT INTO users (username, password_hash, role, institute_id) VALUES
  ('inst_alef', 'pbkdf2$sha256$100000$aW9QOoszpipJngt9qhZT1Q==$vRREOuVPmejdg/P/fgsExDLfIVQ+iCR8r89c6mFTj1M=', 'institute', (SELECT id FROM institutes WHERE name='دبستان الف')),
  ('inst_be',   'pbkdf2$sha256$100000$iUviTGF/E5mFZZP1oRQxig==$0XU7VAV/Epj3WUAR5z3RAOZ2oviR5mR7sNaEdXVQ/3c=',   'institute', (SELECT id FROM institutes WHERE name='دبستان ب')),
  ('inst_jim',  'pbkdf2$sha256$100000$zBNpBexvcSTF1CYrUPGMpw==$0A2D2g+dh16uTVqD8bxqWlW5qdnfzQsw2AQwa/CT5aM=',  'institute', (SELECT id FROM institutes WHERE name='هنرستان ج'));

-- 4) Members
INSERT INTO members (institute_id, name, national_code) VALUES
  ((SELECT id FROM institutes WHERE name='دبستان الف'), 'علی رضایی',   '0012345678'),
  ((SELECT id FROM institutes WHERE name='دبستان الف'), 'زهرا محمدی',  '0023456789'),
  ((SELECT id FROM institutes WHERE name='دبستان الف'), 'حسین کریمی',  '0034567890'),
  ((SELECT id FROM institutes WHERE name='دبستان ب'),   'مریم حسینی',  '0045678901'),
  ((SELECT id FROM institutes WHERE name='دبستان ب'),   'رضا اکبری',   '0056789012'),
  ((SELECT id FROM institutes WHERE name='هنرستان ج'),  'فاطمه نوری',  '0067890123'),
  ((SELECT id FROM institutes WHERE name='هنرستان ج'),  'محمد قاسمی',  '0078901234');
