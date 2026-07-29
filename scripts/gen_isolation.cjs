const crypto = require('crypto')
const fs = require('fs')

function hash(p) {
  const s = crypto.randomBytes(16)
  const d = crypto.pbkdf2Sync(p, s, 100000, 32, 'sha256')
  return `pbkdf2$sha256$100000$${s.toString('base64')}$${d.toString('base64')}`
}

const accounts = {
  midadmin2: { password: 'Mid2@2026Pass', role: 'mid_admin' },
  level1admin2: { password: 'Lvl2@2026Pass', role: 'level1_admin' },
  inst_dal: { password: 'Inst@Dal26', role: 'institute' },
}
const h = {}
for (const k in accounts) h[k] = hash(accounts[k].password)

const sql = `-- seed_isolation.sql — a second, independent management chain for isolation tests.
-- midadmin2 -> level1admin2 -> "آموزشگاه دال". midadmin must NOT see this.

INSERT INTO users (username, password_hash, role) VALUES
  ('midadmin2', '${h.midadmin2}', 'mid_admin');

INSERT INTO users (username, password_hash, role, supervisor_id) VALUES
  ('level1admin2', '${h.level1admin2}', 'level1_admin', (SELECT id FROM users WHERE username='midadmin2'));

INSERT INTO institutes (name, created_by, supervisor_id) VALUES
  ('آموزشگاه دال', (SELECT id FROM users WHERE username='level1admin2'), (SELECT id FROM users WHERE username='level1admin2'));

INSERT INTO users (username, password_hash, role, institute_id) VALUES
  ('inst_dal', '${h.inst_dal}', 'institute', (SELECT id FROM institutes WHERE name='آموزشگاه دال'));

INSERT INTO members (institute_id, name, national_code) VALUES
  ((SELECT id FROM institutes WHERE name='آموزشگاه دال'), 'سارا موسوی', '0089012345'),
  ((SELECT id FROM institutes WHERE name='آموزشگاه دال'), 'امیر تهرانی', '0090123456');
`

fs.writeFileSync('seed_isolation.sql', sql)
console.log('Wrote seed_isolation.sql')
for (const k in accounts) console.log(`  ${k} / ${accounts[k].password}  (${accounts[k].role})`)
