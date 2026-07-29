const crypto = require('crypto')
const fs = require('fs')

function hash(p) {
  const s = crypto.randomBytes(16)
  const d = crypto.pbkdf2Sync(p, s, 100000, 32, 'sha256')
  return `pbkdf2$sha256$100000$${s.toString('base64')}$${d.toString('base64')}`
}

const accounts = {
  midadmin: { password: 'Mid@2026Pass', role: 'mid_admin' },
  level1admin: { password: 'Lvl1@2026Pass', role: 'level1_admin' },
  inst_alef: { password: 'Inst@Alef26', role: 'institute' },
  inst_be: { password: 'Inst@Be26', role: 'institute' },
  inst_jim: { password: 'Inst@Jim26', role: 'institute' },
}
const h = {}
for (const k in accounts) h[k] = hash(accounts[k].password)

const sql = `-- seed_sample.sql — realistic test data. Assumes a clean DB (only root exists).

-- 1) Admin accounts
INSERT INTO users (username, password_hash, role) VALUES
  ('midadmin', '${h.midadmin}', 'mid_admin'),
  ('level1admin', '${h.level1admin}', 'level1_admin');

-- 2) Institutes (two supervised by midadmin, one by level1admin)
INSERT INTO institutes (name, created_by, supervisor_id) VALUES
  ('دبستان الف', (SELECT id FROM users WHERE username='midadmin'),    (SELECT id FROM users WHERE username='midadmin')),
  ('دبستان ب',  (SELECT id FROM users WHERE username='midadmin'),    (SELECT id FROM users WHERE username='midadmin')),
  ('هنرستان ج', (SELECT id FROM users WHERE username='level1admin'), (SELECT id FROM users WHERE username='level1admin'));

-- 3) Institute login accounts (one per institute)
INSERT INTO users (username, password_hash, role, institute_id) VALUES
  ('inst_alef', '${h.inst_alef}', 'institute', (SELECT id FROM institutes WHERE name='دبستان الف')),
  ('inst_be',   '${h.inst_be}',   'institute', (SELECT id FROM institutes WHERE name='دبستان ب')),
  ('inst_jim',  '${h.inst_jim}',  'institute', (SELECT id FROM institutes WHERE name='هنرستان ج'));

-- 4) Members
INSERT INTO members (institute_id, name, national_code) VALUES
  ((SELECT id FROM institutes WHERE name='دبستان الف'), 'علی رضایی',   '0012345678'),
  ((SELECT id FROM institutes WHERE name='دبستان الف'), 'زهرا محمدی',  '0023456789'),
  ((SELECT id FROM institutes WHERE name='دبستان الف'), 'حسین کریمی',  '0034567890'),
  ((SELECT id FROM institutes WHERE name='دبستان ب'),   'مریم حسینی',  '0045678901'),
  ((SELECT id FROM institutes WHERE name='دبستان ب'),   'رضا اکبری',   '0056789012'),
  ((SELECT id FROM institutes WHERE name='هنرستان ج'),  'فاطمه نوری',  '0067890123'),
  ((SELECT id FROM institutes WHERE name='هنرستان ج'),  'محمد قاسمی',  '0078901234');
`

fs.writeFileSync('seed_sample.sql', sql)
console.log('Wrote seed_sample.sql')
console.log('\nCredentials:')
for (const k in accounts) {
  console.log(`  ${k} / ${accounts[k].password}  (${accounts[k].role})`)
}
