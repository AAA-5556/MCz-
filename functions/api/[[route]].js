// ============================================================================
// functions/api/[[route]].js
// Cloudflare Pages Function — Hono app for the Attendance Tracking System.
//
// The [[route]] catch-all means every request under /api/* is routed here.
// The D1 database is bound as `env.DB` (see wrangler.toml).
// ============================================================================

import { Hono } from 'hono'

// Base path is '/api' because this file lives at functions/api/[[route]].js
const app = new Hono().basePath('/api')

// ----------------------------------------------------------------------------
// Timezone helpers — every "today" check is anchored to Asia/Tehran.
//
// Dates are stored/compared as 'YYYY-MM-DD' strings. Because that format is
// zero-padded and big-endian, lexicographic (string) comparison is identical
// to chronological comparison, so `a < b` / `a >= b` on the strings is safe.
// ----------------------------------------------------------------------------

/** Returns the current calendar day in Asia/Tehran as 'YYYY-MM-DD'. */
function todayInTehran() {
  // 'en-CA' formats as YYYY-MM-DD; timeZone shifts the wall clock to Tehran.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** True only for a well-formed 'YYYY-MM-DD' string that names a real date. */
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  // Round-trips only if the components describe a valid date (rejects 2026-02-30).
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

// ----------------------------------------------------------------------------
// Role hierarchy.
//
//   root  >  mid_admin  >  level1_admin  >  institute
//
// A user may create another user ONLY if the target role ranks strictly lower
// than their own. 'institute' (the lowest) may create no one. This single
// table drives both the create-user endpoint and any future role checks.
// ----------------------------------------------------------------------------
const ROLE_RANK = {
  root: 3,
  mid_admin: 2,
  level1_admin: 1,
  institute: 0,
}
const VALID_ROLES = Object.keys(ROLE_RANK)

// ----------------------------------------------------------------------------
// Password hashing — PBKDF2-SHA256 via Web Crypto (available in Workers).
//
// Stored format:  pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>
// Everything needed to re-derive and compare is self-contained in the string.
// ----------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 100000

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
function b64ToBuf(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derivePbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

/** Hash a plaintext password into the storable string form. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${bufToB64(salt)}$${bufToB64(hash)}`
}

/** Constant-time comparison of two equal-length byte arrays. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Verify a plaintext password against a stored pbkdf2$... string. */
async function verifyPassword(password, stored) {
  const parts = String(stored).split('$')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[2])
  const salt = b64ToBuf(parts[3])
  const expected = b64ToBuf(parts[4])
  const actual = await derivePbkdf2(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

// ----------------------------------------------------------------------------
// JWT (HS256) — sign and verify with Web Crypto using env.JWT_SECRET.
// ----------------------------------------------------------------------------
function b64urlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
function b64urlEncodeString(str) {
  return b64urlEncode(new TextEncoder().encode(str))
}
function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  return b64ToBuf(b64 + pad)
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Sign a payload into an HS256 JWT. Adds iat/exp (default 12h). */
async function signToken(payload, secret, expiresInSec = 12 * 60 * 60) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSec }
  const headerB64 = b64urlEncodeString(JSON.stringify(header))
  const payloadB64 = b64urlEncodeString(JSON.stringify(fullPayload))
  const data = `${headerB64}.${payloadB64}`
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`
}

/**
 * Verify an HS256 JWT signature + expiry against `secret`.
 * Returns the decoded payload, or throws on any failure.
 */
async function verifyToken(token, secret) {
  if (!secret) throw new Error('JWT secret not configured')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed token')
  const [headerB64, payloadB64, sigB64] = parts

  const key = await hmacKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  )
  if (!valid) throw new Error('Bad signature')

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)))
  } catch {
    throw new Error('Unreadable token payload')
  }

  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error('Token expired')
  }
  return payload
}

// ----------------------------------------------------------------------------
// POST /api/login  (PUBLIC — registered before the auth middleware below).
//   Body: { username, password } -> { token, user }
// ----------------------------------------------------------------------------
app.post('/login', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const { username, password } = body
  if (typeof username !== 'string' || typeof password !== 'string') {
    return c.json({ error: 'username and password are required' }, 400)
  }

  const row = await c.env.DB.prepare(
    'SELECT id, username, password_hash, role, institute_id, display_name FROM users WHERE username = ?',
  )
    .bind(username)
    .first()

  // Same generic error whether the user is missing or the password is wrong.
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.json({ error: 'Invalid username or password' }, 401)
  }

  const user = {
    id: row.id,
    username: row.username,
    role: row.role,
    institute_id: row.institute_id ?? null,
    display_name: row.display_name ?? null,
  }
  const token = await signToken(
    { sub: row.id, role: row.role, institute_id: row.institute_id ?? null },
    c.env.JWT_SECRET,
  )
  return c.json({ token, user })
})

// ----------------------------------------------------------------------------
// JWT authentication middleware — guards everything registered AFTER this.
// ----------------------------------------------------------------------------
async function authMiddleware(c, next) {
  const header = c.req.header('Authorization') || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return c.json({ error: 'Unauthorized: missing Bearer token' }, 401)
  }

  let payload
  try {
    payload = await verifyToken(token, c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'Unauthorized: invalid token' }, 401)
  }

  const role = payload.role
  if (!VALID_ROLES.includes(role)) {
    return c.json({ error: 'Unauthorized: unknown role' }, 401)
  }

  // Normalize institute_id: only meaningful for 'institute' users.
  const instituteId =
    payload.institute_id === undefined ? null : payload.institute_id

  c.set('user', {
    id: payload.sub ?? payload.id ?? null,
    role,
    institute_id: instituteId,
  })

  await next()
}

// Guard the whole API surface behind auth.
app.use('*', authMiddleware)

// Small helper: role gate that returns a 403 when the user isn't allowed.
function requireRole(user, allowed) {
  if (!allowed.includes(user.role)) {
    return { ok: false, res: { error: 'Forbidden: insufficient role' }, status: 403 }
  }
  return { ok: true }
}

// Coerce a JSON value to an integer, accepting numeric strings ("7" -> 7).
// Returns NaN for anything that isn't an integer, so callers can validate with
// Number.isInteger(...). null/undefined/'' all become NaN (i.e. "not provided").
function toInt(value) {
  if (value === null || value === undefined || value === '') return NaN
  const n = Number(value)
  return Number.isInteger(n) ? n : NaN
}

// ----------------------------------------------------------------------------
// Supervision / visibility helpers  (new hierarchy).
//
//   root         -> everything
//   mid_admin    -> the level1_admins it supervises (users.supervisor_id),
//                   and INDIRECTLY the institutes those level1_admins own.
//                   A mid_admin does NOT own institutes directly.
//   level1_admin -> the institutes it supervises (institutes.supervisor_id).
//   institute    -> only its own institute.
//
// Only root may reassign a level1_admin from one mid_admin to another.
// ----------------------------------------------------------------------------

/** Fetch one institute row (with supervision columns) or null. */
async function getInstitute(db, instituteId) {
  return db
    .prepare(
      'SELECT id, name, created_by, supervisor_id FROM institutes WHERE id = ?',
    )
    .bind(instituteId)
    .first()
}

/**
 * Build a SQL condition restricting an institute-id column to what `user` may
 * see. Returns { sql, binds }. Empty sql means "no restriction" (root, all).
 * `col` is the column expression, e.g. 'i.id' or 'a.institute_id'.
 */
function instituteScope(user, col) {
  switch (user.role) {
    case 'root':
      return { sql: '', binds: [] }
    case 'institute':
      return { sql: `${col} = ?`, binds: [user.institute_id] }
    case 'level1_admin':
      // Institutes directly supervised by this level1_admin.
      return {
        sql: `${col} IN (SELECT id FROM institutes WHERE supervisor_id = ?)`,
        binds: [user.id],
      }
    case 'mid_admin':
      // Institutes owned by any level1_admin this mid_admin supervises.
      return {
        sql: `${col} IN (SELECT id FROM institutes WHERE supervisor_id IN (
                SELECT id FROM users WHERE role = 'level1_admin' AND supervisor_id = ?
              ))`,
        binds: [user.id],
      }
    default:
      return { sql: '1 = 0', binds: [] } // deny
  }
}

/**
 * True if `user` may view/manage the data of a specific institute row.
 * Async because mid_admin needs to check the owning level1_admin's supervisor.
 */
async function canViewInstitute(db, user, institute) {
  if (!institute) return false
  if (user.role === 'root') return true
  if (user.role === 'institute') return user.institute_id === institute.id
  if (user.role === 'level1_admin') return institute.supervisor_id === user.id
  if (user.role === 'mid_admin') {
    if (institute.supervisor_id == null) return false
    const sup = await db
      .prepare('SELECT role, supervisor_id FROM users WHERE id = ?')
      .bind(institute.supervisor_id)
      .first()
    return !!sup && sup.role === 'level1_admin' && sup.supervisor_id === user.id
  }
  return false
}

/**
 * True if `user` may WRITE (add/edit/delete) members of a specific institute.
 * Stricter than canViewInstitute: a mid_admin can VIEW an institute's members
 * (for reports) but must NOT edit/delete them. Member CRUD is limited to:
 *   - root
 *   - the institute itself (its own roster)
 *   - the DIRECT level1_admin supervising that institute
 * A mid_admin is intentionally excluded (read-only).
 */
function canManageInstituteMembers(user, institute) {
  if (!institute) return false
  if (user.role === 'root') return true
  if (user.role === 'institute') return user.institute_id === institute.id
  if (user.role === 'level1_admin') return institute.supervisor_id === user.id
  return false // mid_admin and anyone else: read-only
}

/**
 * True if `caller` manages `target` user (for delete / password reset / list).
 *   root         -> anyone but itself
 *   mid_admin    -> level1_admins it supervises
 *   level1_admin -> institute users of institutes it supervises
 */
async function canManageUser(db, caller, target) {
  if (!target || target.id === caller.id) return false
  if (caller.role === 'root') return true
  if (caller.role === 'mid_admin') {
    return target.role === 'level1_admin' && target.supervisor_id === caller.id
  }
  if (caller.role === 'level1_admin') {
    if (target.role !== 'institute' || target.institute_id == null) return false
    const inst = await db
      .prepare('SELECT supervisor_id FROM institutes WHERE id = ?')
      .bind(target.institute_id)
      .first()
    return !!inst && inst.supervisor_id === caller.id
  }
  return false
}

// ----------------------------------------------------------------------------
// GET /api/time — diagnostic: what the server considers "now" in Tehran vs UTC.
//   Use this to confirm the daily lock resets at Tehran midnight (UTC+3:30).
// ----------------------------------------------------------------------------
app.get('/time', async (c) => {
  const now = new Date()
  const tehran = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now)
  return c.json({
    tehran_today: todayInTehran(),
    tehran_datetime: tehran,
    utc_iso: now.toISOString(),
    note: 'Daily attendance lock is based on tehran_today (Asia/Tehran, UTC+3:30).',
  })
})

// ----------------------------------------------------------------------------
// GET /api/me — the current authenticated user + their direct supervisor.
//   Supervisor by role:
//     level1_admin -> its mid_admin (users.supervisor_id)
//     institute    -> the level1_admin supervising its institute
//     mid_admin/root -> none
// ----------------------------------------------------------------------------
app.get('/me', async (c) => {
  const user = c.get('user')
  const row = await c.env.DB.prepare(
    'SELECT id, username, role, institute_id, supervisor_id, display_name FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first()
  if (!row) return c.json({ error: 'User no longer exists' }, 404)

  // Resolve the direct supervisor's id for this user.
  let supervisorId = null
  if (row.role === 'level1_admin') {
    supervisorId = row.supervisor_id ?? null
  } else if (row.role === 'institute' && row.institute_id != null) {
    const inst = await c.env.DB.prepare(
      'SELECT supervisor_id FROM institutes WHERE id = ?',
    ).bind(row.institute_id).first()
    supervisorId = inst?.supervisor_id ?? null
  }

  let supervisor = null
  if (supervisorId != null) {
    const sup = await c.env.DB.prepare(
      'SELECT username, role, display_name FROM users WHERE id = ?',
    ).bind(supervisorId).first()
    if (sup) {
      supervisor = {
        username: sup.username,
        role: sup.role,
        display_name: sup.display_name ?? sup.username,
      }
    }
  }

  return c.json({ user: row, supervisor })
})

// ----------------------------------------------------------------------------
// PATCH /api/me/password — change YOUR OWN password.
//   Body: { current_password, new_password }
//   The current password is verified with PBKDF2 before the change is applied.
//   Available to every authenticated role, for their own account only.
// ----------------------------------------------------------------------------
app.patch('/me/password', async (c) => {
  const user = c.get('user')

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const currentPassword = body.current_password
  const newPassword = body.new_password
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return c.json({ error: 'current_password and new_password are required' }, 400)
  }
  if (newPassword.length < 8) {
    return c.json({ error: "'new_password' must be at least 8 characters" }, 400)
  }

  const row = await c.env.DB.prepare(
    'SELECT id, password_hash FROM users WHERE id = ?',
  ).bind(user.id).first()
  if (!row) return c.json({ error: 'User no longer exists' }, 404)

  // Verify the current password with the same PBKDF2 scheme used at login.
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return c.json({ error: 'رمز عبور فعلی نادرست است.' }, 401)
  }

  const password_hash = await hashPassword(newPassword)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(password_hash, user.id)
    .run()

  return c.json({ ok: true })
})

// ----------------------------------------------------------------------------
// GET /api/users/mid-admins — list mid_admins (for root to assign as a
//   level1_admin's supervisor). root only.
// ----------------------------------------------------------------------------
app.get('/users/mid-admins', async (c) => {
  const user = c.get('user')
  if (user.role !== 'root') return c.json({ error: 'Forbidden' }, 403)
  const { results } = await c.env.DB.prepare(
    "SELECT id, username, display_name FROM users WHERE role = 'mid_admin' ORDER BY username",
  ).all()
  return c.json({ mid_admins: results ?? [] })
})

// ----------------------------------------------------------------------------
// GET /api/users/level1-admins — level1_admins assignable as an institute's
//   supervisor. root -> all; mid_admin -> only its own. (For the transfer UI.)
// ----------------------------------------------------------------------------
app.get('/users/level1-admins', async (c) => {
  const user = c.get('user')
  if (user.role === 'root') {
    const { results } = await c.env.DB.prepare(
      "SELECT id, username FROM users WHERE role = 'level1_admin' ORDER BY username",
    ).all()
    return c.json({ level1_admins: results ?? [] })
  }
  if (user.role === 'mid_admin') {
    const { results } = await c.env.DB.prepare(
      "SELECT id, username FROM users WHERE role = 'level1_admin' AND supervisor_id = ? ORDER BY username",
    ).bind(user.id).all()
    return c.json({ level1_admins: results ?? [] })
  }
  return c.json({ error: 'Forbidden' }, 403)
})

// ----------------------------------------------------------------------------
// GET /api/users — list the users the caller MANAGES (for the User Mgmt page).
//   root         -> all users (except itself is still listed, but not deletable)
//   mid_admin    -> the level1_admins it supervises
//   level1_admin -> the institute users of institutes it supervises
//   institute    -> 403
// ----------------------------------------------------------------------------
app.get('/users', async (c) => {
  const user = c.get('user')

  let sql = `
    SELECT u.id, u.username, u.role, u.institute_id, u.supervisor_id, u.display_name,
           i.name AS institute_name, su.username AS supervisor_username
    FROM users u
    LEFT JOIN institutes i ON i.id = u.institute_id
    LEFT JOIN users su ON su.id = u.supervisor_id
  `
  const binds = []

  if (user.role === 'root') {
    // all
  } else if (user.role === 'mid_admin') {
    sql += " WHERE u.role = 'level1_admin' AND u.supervisor_id = ?"
    binds.push(user.id)
  } else if (user.role === 'level1_admin') {
    sql += ` WHERE u.role = 'institute' AND u.institute_id IN (
               SELECT id FROM institutes WHERE supervisor_id = ?
             )`
    binds.push(user.id)
  } else {
    return c.json({ error: 'Forbidden' }, 403)
  }

  sql += ' ORDER BY u.role, u.username'
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  // Never leak password hashes (they aren't selected, but be explicit).
  return c.json({ users: results ?? [], self_id: user.id })
})

// ----------------------------------------------------------------------------
// DELETE /api/users/:id — delete a user the caller manages.
//   Cascades: deleting a level1_admin detaches its institutes' supervisor
//   (SET NULL); deleting an institute user just removes the login.
// ----------------------------------------------------------------------------
app.delete('/users/:id', async (c) => {
  const caller = c.get('user')
  const targetId = Number(c.req.param('id'))
  if (!Number.isInteger(targetId)) return c.json({ error: 'Invalid user id' }, 400)

  const target = await c.env.DB.prepare(
    'SELECT id, role, institute_id, supervisor_id FROM users WHERE id = ?',
  ).bind(targetId).first()
  if (!target) return c.json({ error: 'User not found' }, 404)

  if (!(await canManageUser(c.env.DB, caller, target))) {
    return c.json({ error: 'Forbidden: you do not manage this user' }, 403)
  }

  // Detach references before deleting, so nothing is left dangling:
  //   - a mid_admin's level1_admins lose their supervisor (become unassigned)
  //   - a level1_admin's institutes lose their supervisor (root-only until reassigned)
  const stmts = []
  if (target.role === 'mid_admin') {
    stmts.push(
      c.env.DB.prepare('UPDATE users SET supervisor_id = NULL WHERE supervisor_id = ?').bind(targetId),
    )
  } else if (target.role === 'level1_admin') {
    stmts.push(
      c.env.DB.prepare('UPDATE institutes SET supervisor_id = NULL WHERE supervisor_id = ?').bind(targetId),
    )
  }
  stmts.push(c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId))
  await c.env.DB.batch(stmts)

  return c.json({ ok: true, deleted_id: targetId })
})

// ----------------------------------------------------------------------------
// PATCH /api/users/:id/password — reset a managed user's password.
//   Body: { password }  (min 8 chars)
// ----------------------------------------------------------------------------
app.patch('/users/:id/password', async (c) => {
  const caller = c.get('user')
  const targetId = Number(c.req.param('id'))
  if (!Number.isInteger(targetId)) return c.json({ error: 'Invalid user id' }, 400)

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const password = body.password
  if (typeof password !== 'string' || password.length < 8) {
    return c.json({ error: "'password' must be at least 8 characters" }, 400)
  }

  const target = await c.env.DB.prepare(
    'SELECT id, role, institute_id, supervisor_id FROM users WHERE id = ?',
  ).bind(targetId).first()
  if (!target) return c.json({ error: 'User not found' }, 404)

  // A user may reset their own password; otherwise must manage the target.
  const allowed =
    targetId === caller.id || (await canManageUser(c.env.DB, caller, target))
  if (!allowed) {
    return c.json({ error: 'Forbidden: you do not manage this user' }, 403)
  }

  const password_hash = await hashPassword(password)
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(password_hash, targetId)
    .run()
  return c.json({ ok: true, user_id: targetId })
})

// ----------------------------------------------------------------------------
// POST /api/users  — create a new user under the new hierarchy.
//
//   - root         -> mid_admin | level1_admin | institute
//   - mid_admin    -> level1_admin  (becomes its supervisor)
//   - level1_admin -> institute     (only for institutes it supervises)
//   - institute    -> nobody (403)
//
// Supervisor assignment:
//   - creating level1_admin: supervisor is a mid_admin.
//       * mid_admin creator -> supervisor = creator (forced)
//       * root creator      -> optional body.supervisor_id (a mid_admin) or null
//   - creating institute user: body.institute_id required; the creator must be
//       able to view that institute. supervisor_id stays null (uses institute_id).
//   Body: { username, password, role, institute_id?, supervisor_id? }
// ----------------------------------------------------------------------------
const CREATABLE = {
  root: ['mid_admin', 'level1_admin', 'institute'],
  mid_admin: ['level1_admin'],
  level1_admin: ['institute'],
  institute: [],
}

app.post('/users', async (c) => {
  const creator = c.get('user')

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { username, password, role } = body
  let institute_id = body.institute_id ?? null
  let supervisor_id = null
  const displayName =
    typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim()
      : null

  // --- validate inputs ---
  if (typeof username !== 'string' || username.trim().length < 3) {
    return c.json({ error: "'username' must be at least 3 characters" }, 400)
  }
  if (typeof password !== 'string' || password.length < 8) {
    return c.json({ error: "'password' must be at least 8 characters" }, 400)
  }
  if (!VALID_ROLES.includes(role)) {
    return c.json({ error: "'role' must be one of " + VALID_ROLES.join(', ') }, 400)
  }

  // --- creation-permission enforcement (explicit table, not just rank) ---
  if (!(CREATABLE[creator.role] || []).includes(role)) {
    return c.json(
      {
        error: `Forbidden: a '${creator.role}' user cannot create a '${role}' user.`,
      },
      403,
    )
  }

  // --- role-specific linkage ---
  if (role === 'institute') {
    // An institute account IS an institute. If no existing institute_id is
    // given, auto-create one named after the display name (or username),
    // owned by the creating level1_admin (or unassigned when root creates it).
    const providedId = toInt(institute_id)
    if (Number.isInteger(providedId)) {
      const institute = await getInstitute(c.env.DB, providedId)
      if (!institute) return c.json({ error: 'institute_id does not exist' }, 400)
      if (!(await canViewInstitute(c.env.DB, creator, institute))) {
        return c.json({ error: 'Forbidden: you cannot add users to this institute' }, 403)
      }
      institute_id = providedId
    } else {
      const instName = displayName || username.trim()
      const supForInstitute = creator.role === 'level1_admin' ? creator.id : null
      const inst = await c.env.DB.prepare(
        'INSERT INTO institutes (name, created_by, supervisor_id) VALUES (?, ?, ?)',
      ).bind(instName, creator.id, supForInstitute).run()
      institute_id = inst.meta?.last_row_id ?? null
      if (!Number.isInteger(institute_id)) {
        return c.json({ error: 'Failed to create institute for this account' }, 500)
      }
    }
  } else if (role === 'level1_admin') {
    institute_id = null
    if (creator.role === 'mid_admin') {
      supervisor_id = creator.id // forced to the creating mid_admin
    } else if (creator.role === 'root') {
      // optional: assign an existing mid_admin as supervisor
      if (body.supervisor_id !== undefined && body.supervisor_id !== null) {
        const midId = toInt(body.supervisor_id)
        if (!Number.isInteger(midId)) {
          return c.json({ error: "Invalid 'supervisor_id'" }, 400)
        }
        const mid = await c.env.DB.prepare(
          "SELECT id FROM users WHERE id = ? AND role = 'mid_admin'",
        ).bind(midId).first()
        if (!mid) return c.json({ error: 'supervisor_id must be an existing mid_admin' }, 400)
        supervisor_id = midId
      }
    }
  } else {
    // mid_admin: no supervisor, no institute
    institute_id = null
    supervisor_id = null
  }

  // --- create ---
  const password_hash = await hashPassword(password)
  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO users (username, password_hash, role, institute_id, supervisor_id, display_name) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(username.trim(), password_hash, role, institute_id, supervisor_id, displayName)
      .run()

    return c.json(
      {
        ok: true,
        user: {
          id: result.meta?.last_row_id ?? null,
          username: username.trim(),
          role,
          institute_id,
          supervisor_id,
          display_name: displayName,
        },
      },
      201,
    )
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return c.json({ error: 'That username is already taken' }, 409)
    }
    throw err
  }
})

// ----------------------------------------------------------------------------
// 2. POST /api/attendance  — submit / update TODAY's attendance.
//    Only 'institute' users. Only today's date (Asia/Tehran). UPSERT.
// ----------------------------------------------------------------------------
app.post('/attendance', async (c) => {
  const user = c.get('user')

  const gate = requireRole(user, ['institute'])
  if (!gate.ok) return c.json(gate.res, gate.status)

  if (user.institute_id == null) {
    return c.json({ error: 'Forbidden: user is not linked to an institute' }, 403)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { date, status } = body
  const member_id = toInt(body.member_id)

  if (!isValidDateString(date)) {
    return c.json({ error: "Invalid 'date' — expected 'YYYY-MM-DD'" }, 400)
  }
  if (!Number.isInteger(member_id)) {
    return c.json({ error: "Invalid 'member_id'" }, 400)
  }
  if (status !== 'present' && status !== 'absent') {
    return c.json({ error: "Invalid 'status' — expected 'present' or 'absent'" }, 400)
  }

  const today = todayInTehran()

  // Past days are locked. Future days aren't allowed either (can only mark today).
  if (date < today) {
    return c.json(
      { error: 'Error: Past days are locked and cannot be changed.' },
      403,
    )
  }
  if (date > today) {
    return c.json({ error: 'Error: You can only submit attendance for today.' }, 403)
  }

  // Confirm the member actually belongs to this institute before writing —
  // stops one institute from marking another institute's members.
  const member = await c.env.DB.prepare(
    'SELECT id FROM members WHERE id = ? AND institute_id = ?',
  )
    .bind(member_id, user.institute_id)
    .first()

  if (!member) {
    return c.json({ error: 'Member not found in your institute' }, 404)
  }

  // UPSERT: relies on the UNIQUE(member_id, date) constraint in the schema.
  await c.env.DB.prepare(
    `INSERT INTO attendance (institute_id, member_id, date, status)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(member_id, date)
     DO UPDATE SET status = excluded.status`,
  )
    .bind(user.institute_id, member_id, date, status)
    .run()

  return c.json({ ok: true, member_id, date, status })
})

// ----------------------------------------------------------------------------
// 3. GET /api/attendance?date=YYYY-MM-DD  — list members + their status for a day.
//    institute     -> own institute only.
//    level1_admin  -> only institutes it supervises.
//    mid_admin     -> only institutes it supervises.
//    root          -> everything.
//    Optional ?institute_id=N narrows to one institute (access-checked).
// ----------------------------------------------------------------------------
app.get('/attendance', async (c) => {
  const user = c.get('user')
  const date = c.req.query('date')

  if (!isValidDateString(date)) {
    return c.json({ error: "Invalid or missing 'date' — expected 'YYYY-MM-DD'" }, 400)
  }

  // Build a WHERE clause on m.institute_id appropriate to the caller.
  const requested = c.req.query('institute_id')
  let scopeSql = ''
  let scopeBinds = []

  if (requested !== undefined) {
    // Narrow to one institute, access-checked.
    const id = Number(requested)
    if (!Number.isInteger(id)) return c.json({ error: "Invalid 'institute_id'" }, 400)
    const institute = await getInstitute(c.env.DB, id)
    if (!(await canViewInstitute(c.env.DB, user, institute))) {
      return c.json({ error: 'Forbidden: you cannot view this institute' }, 403)
    }
    scopeSql = 'm.institute_id = ?'
    scopeBinds = [id]
  } else {
    const scope = instituteScope(user, 'm.institute_id')
    scopeSql = scope.sql
    scopeBinds = scope.binds
  }

  // LEFT JOIN so members with no row for `date` come back with status = NULL.
  let sql = `
    SELECT
      m.id            AS member_id,
      m.name          AS name,
      m.national_code AS national_code,
      m.institute_id  AS institute_id,
      a.status        AS status,
      a.date          AS date
    FROM members m
    LEFT JOIN attendance a
      ON a.member_id = m.id AND a.date = ?
  `
  const binds = [date, ...scopeBinds]
  if (scopeSql) sql += ' WHERE ' + scopeSql
  sql += ' ORDER BY m.institute_id, m.name'

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()

  // Normalize: a member with no attendance row reads as { status: null }.
  const members = (results ?? []).map((r) => ({
    member_id: r.member_id,
    name: r.name,
    national_code: r.national_code,
    institute_id: r.institute_id,
    status: r.status ?? null, // 'present' | 'absent' | null (not yet marked)
    date,
  }))

  return c.json({ date, count: members.length, members })
})

// ----------------------------------------------------------------------------
// 4. DELETE /api/attendance/history  — manual history purge.
//    Only 'root' and 'mid_admin'. mid_admin is limited to institutes it
//    supervises; root may target any. Cannot delete today or future dates.
//    Body: { institute_id, target_date }
//    Runs: DELETE FROM attendance WHERE institute_id = ? AND date <= ?
// ----------------------------------------------------------------------------
app.delete('/attendance/history', async (c) => {
  const user = c.get('user')

  const gate = requireRole(user, ['root', 'mid_admin'])
  if (!gate.ok) return c.json(gate.res, gate.status)

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { target_date } = body
  const institute_id = toInt(body.institute_id)

  if (!isValidDateString(target_date)) {
    return c.json({ error: "Invalid 'target_date' — expected 'YYYY-MM-DD'" }, 400)
  }
  if (!Number.isInteger(institute_id)) {
    return c.json({ error: "Invalid 'institute_id'" }, 400)
  }

  // A mid_admin may only purge institutes it supervises (indirectly); root any.
  if (user.role === 'mid_admin') {
    const institute = await getInstitute(c.env.DB, institute_id)
    if (!(await canViewInstitute(c.env.DB, user, institute))) {
      return c.json(
        { error: 'Forbidden: you do not supervise this institute' },
        403,
      )
    }
  }

  const today = todayInTehran()

  // Security rule: refuse to touch today or anything in the future.
  if (target_date >= today) {
    return c.json(
      { error: 'Error: You cannot delete today or future dates.' },
      403,
    )
  }

  const result = await c.env.DB.prepare(
    'DELETE FROM attendance WHERE institute_id = ? AND date <= ?',
  )
    .bind(institute_id, target_date)
    .run()

  return c.json({
    ok: true,
    institute_id,
    target_date,
    deleted: result.meta?.changes ?? 0,
  })
})

// ----------------------------------------------------------------------------
// INSTITUTES
// ----------------------------------------------------------------------------

// GET /api/institutes — list institutes the caller is allowed to see.
//   root         -> all
//   mid_admin    -> institutes owned by level1_admins it supervises (indirect)
//   level1_admin -> only those it supervises directly
//   institute    -> only its own
app.get('/institutes', async (c) => {
  const user = c.get('user')

  let sql = `
    SELECT
      i.id, i.name, i.created_by, i.supervisor_id,
      cu.username AS created_by_username,
      su.username AS supervisor_username,
      (SELECT COUNT(*) FROM members m WHERE m.institute_id = i.id) AS member_count
    FROM institutes i
    LEFT JOIN users cu ON cu.id = i.created_by
    LEFT JOIN users su ON su.id = i.supervisor_id
  `
  const scope = instituteScope(user, 'i.id')
  const binds = []
  if (scope.sql) {
    sql += ' WHERE ' + scope.sql
    binds.push(...scope.binds)
  }
  sql += ' ORDER BY i.name'

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ institutes: results ?? [] })
})

// POST /api/institutes — create an institute. root and level1_admin only
//   (mid_admin does NOT own institutes directly).
//   - level1_admin -> supervisor = self.
//   - root         -> optional body.supervisor_id (a level1_admin) else null.
//   Body: { name, supervisor_id? }
app.post('/institutes', async (c) => {
  const user = c.get('user')
  const gate = requireRole(user, ['root', 'level1_admin'])
  if (!gate.ok) return c.json(gate.res, gate.status)

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length < 2) {
    return c.json({ error: "'name' must be at least 2 characters" }, 400)
  }

  let supervisorId
  if (user.role === 'level1_admin') {
    supervisorId = user.id
  } else {
    // root: optionally assign a level1_admin as supervisor.
    supervisorId = null
    if (body.supervisor_id !== undefined && body.supervisor_id !== null) {
      const lvlId = toInt(body.supervisor_id)
      if (!Number.isInteger(lvlId)) {
        return c.json({ error: "Invalid 'supervisor_id'" }, 400)
      }
      const lvl = await c.env.DB.prepare(
        "SELECT id FROM users WHERE id = ? AND role = 'level1_admin'",
      ).bind(lvlId).first()
      if (!lvl) return c.json({ error: 'supervisor_id must be an existing level1_admin' }, 400)
      supervisorId = lvlId
    }
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO institutes (name, created_by, supervisor_id) VALUES (?, ?, ?)',
  )
    .bind(name, user.id, supervisorId)
    .run()

  return c.json(
    {
      ok: true,
      institute: {
        id: result.meta?.last_row_id ?? null,
        name,
        created_by: user.id,
        supervisor_id: supervisorId,
      },
    },
    201,
  )
})

// PATCH /api/institutes/:id/supervisor — reassign an institute to a level1_admin.
//   root      -> may assign the institute to ANY level1_admin.
//   mid_admin -> may reassign only WITHIN its own branch: the institute must
//                currently be supervised by one of the mid_admin's level1_admins,
//                AND the new supervisor must also be one of its level1_admins.
//   Body: { supervisor_id }  (an existing level1_admin)
app.patch('/institutes/:id/supervisor', async (c) => {
  const user = c.get('user')
  if (user.role !== 'root' && user.role !== 'mid_admin') {
    return c.json(
      { error: 'Forbidden: only root and mid_admin can transfer institutes' },
      403,
    )
  }

  const instituteId = Number(c.req.param('id'))
  if (!Number.isInteger(instituteId)) {
    return c.json({ error: 'Invalid institute id' }, 400)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const newSupervisorId = toInt(body.supervisor_id)
  if (!Number.isInteger(newSupervisorId)) {
    return c.json({ error: "Invalid 'supervisor_id'" }, 400)
  }

  const institute = await getInstitute(c.env.DB, instituteId)
  if (!institute) return c.json({ error: 'Institute not found' }, 404)

  // The new supervisor must be a level1_admin.
  const newSup = await c.env.DB.prepare(
    "SELECT id, role, supervisor_id FROM users WHERE id = ?",
  ).bind(newSupervisorId).first()
  if (!newSup || newSup.role !== 'level1_admin') {
    return c.json({ error: 'supervisor_id must be an existing level1_admin' }, 400)
  }

  if (user.role === 'mid_admin') {
    // The institute must currently be inside this mid_admin's branch...
    if (!(await canViewInstitute(c.env.DB, user, institute))) {
      return c.json({ error: 'Forbidden: this institute is not in your branch' }, 403)
    }
    // ...and the destination level1_admin must also be one of theirs.
    if (newSup.supervisor_id !== user.id) {
      return c.json(
        { error: 'Forbidden: the target level1_admin is not in your branch' },
        403,
      )
    }
  }

  await c.env.DB.prepare('UPDATE institutes SET supervisor_id = ? WHERE id = ?')
    .bind(newSupervisorId, instituteId)
    .run()

  return c.json({ ok: true, institute_id: instituteId, supervisor_id: newSupervisorId })
})

// PATCH /api/users/:id/supervisor — transfer a level1_admin from one mid_admin
//   to another. ROOT ONLY (per the hierarchy rules).
//   Body: { supervisor_id }  (must be an existing mid_admin, or null to detach)
app.patch('/users/:id/supervisor', async (c) => {
  const user = c.get('user')
  if (user.role !== 'root') {
    return c.json(
      { error: 'Forbidden: only root can transfer a level1_admin between mid_admins' },
      403,
    )
  }

  const targetId = Number(c.req.param('id'))
  if (!Number.isInteger(targetId)) {
    return c.json({ error: 'Invalid user id' }, 400)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  // supervisor_id may be null (detach) or a numeric id.
  const supervisorId =
    body.supervisor_id === undefined || body.supervisor_id === null
      ? null
      : toInt(body.supervisor_id)
  if (supervisorId !== null && !Number.isInteger(supervisorId)) {
    return c.json({ error: "Invalid 'supervisor_id'" }, 400)
  }

  // Target must be a level1_admin.
  const target = await c.env.DB.prepare(
    'SELECT id, role FROM users WHERE id = ?',
  ).bind(targetId).first()
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (target.role !== 'level1_admin') {
    return c.json({ error: 'Only a level1_admin can be reassigned' }, 400)
  }

  // New supervisor (if any) must be a mid_admin.
  if (supervisorId !== null) {
    const mid = await c.env.DB.prepare(
      "SELECT id FROM users WHERE id = ? AND role = 'mid_admin'",
    ).bind(supervisorId).first()
    if (!mid) return c.json({ error: 'supervisor_id must be an existing mid_admin' }, 400)
  }

  await c.env.DB.prepare('UPDATE users SET supervisor_id = ? WHERE id = ?')
    .bind(supervisorId, targetId)
    .run()

  return c.json({ ok: true, user_id: targetId, supervisor_id: supervisorId })
})

// ----------------------------------------------------------------------------
// MEMBERS
// ----------------------------------------------------------------------------

// GET /api/members?institute_id=N — members of an institute the caller can view.
app.get('/members', async (c) => {
  const user = c.get('user')

  let instituteId
  if (user.role === 'institute') {
    instituteId = user.institute_id
  } else {
    instituteId = Number(c.req.query('institute_id'))
    if (!Number.isInteger(instituteId)) {
      return c.json({ error: "Query 'institute_id' is required" }, 400)
    }
  }

  const institute = await getInstitute(c.env.DB, instituteId)
  if (!(await canViewInstitute(c.env.DB, user, institute))) {
    return c.json({ error: 'Forbidden: you cannot view this institute' }, 403)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, institute_id, first_name, last_name, name, national_code, phone, extra_info, created_at
     FROM members WHERE institute_id = ? ORDER BY last_name, first_name`,
  )
    .bind(instituteId)
    .all()

  return c.json({ institute_id: instituteId, members: results ?? [] })
})

// POST /api/members — add a member.
//   Mandatory: first_name, last_name. Optional: national_code, phone, extra_info.
//   Body: { first_name, last_name, national_code?, phone?, extra_info?, institute_id? }
app.post('/members', async (c) => {
  const user = c.get('user')

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : ''
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : ''
  const nationalCode =
    typeof body.national_code === 'string' ? body.national_code.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const extraInfo = typeof body.extra_info === 'string' ? body.extra_info.trim() : ''

  if (firstName.length < 1 || lastName.length < 1) {
    return c.json({ error: "'first_name' and 'last_name' are required" }, 400)
  }
  // national_code is optional, but if provided it must be exactly 10 digits.
  if (nationalCode !== '' && !/^\d{10}$/.test(nationalCode)) {
    return c.json({ error: "'national_code' must be 10 digits (or left empty)" }, 400)
  }

  const instituteId =
    user.role === 'institute' ? user.institute_id : Number(body.institute_id)
  if (!Number.isInteger(instituteId)) {
    return c.json({ error: "'institute_id' is required" }, 400)
  }

  const institute = await getInstitute(c.env.DB, instituteId)
  if (!canManageInstituteMembers(user, institute)) {
    return c.json({ error: 'Forbidden: you cannot modify members of this institute' }, 403)
  }

  const name = `${firstName} ${lastName}`.trim()
  const createdAt = new Date().toISOString()

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO members (institute_id, first_name, last_name, name, national_code, phone, extra_info, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(instituteId, firstName, lastName, name, nationalCode, phone, extraInfo, createdAt)
      .run()
    return c.json(
      {
        ok: true,
        member: {
          id: result.meta?.last_row_id ?? null,
          institute_id: instituteId,
          first_name: firstName,
          last_name: lastName,
          name,
          national_code: nationalCode,
          phone,
          extra_info: extraInfo,
          created_at: createdAt,
        },
      },
      201,
    )
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return c.json(
        { error: 'A member with this national code already exists in this institute' },
        409,
      )
    }
    throw err
  }
})

// Shared: load a member and confirm the caller may modify its institute.
async function loadMemberForWrite(c, user, memberId) {
  const member = await c.env.DB.prepare(
    `SELECT id, institute_id, first_name, last_name, name, national_code, phone, extra_info, created_at
     FROM members WHERE id = ?`,
  )
    .bind(memberId)
    .first()
  if (!member) return { error: 'Member not found', status: 404 }
  const institute = await getInstitute(c.env.DB, member.institute_id)
  if (!canManageInstituteMembers(user, institute)) {
    return { error: 'Forbidden: you cannot modify members of this institute', status: 403 }
  }
  return { member }
}

// PATCH /api/members/:id — edit a member's fields.
//   Body: { first_name?, last_name?, national_code?, phone?, extra_info? }
app.patch('/members/:id', async (c) => {
  const user = c.get('user')
  const memberId = Number(c.req.param('id'))
  if (!Number.isInteger(memberId)) {
    return c.json({ error: 'Invalid member id' }, 400)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const loaded = await loadMemberForWrite(c, user, memberId)
  if (loaded.error) return c.json({ error: loaded.error }, loaded.status)

  // Start from existing values; apply only provided fields.
  const m = loaded.member
  const next = {
    first_name: m.first_name,
    last_name: m.last_name,
    national_code: m.national_code ?? '',
    phone: m.phone ?? '',
    extra_info: m.extra_info ?? '',
  }
  if (body.first_name !== undefined) {
    const v = String(body.first_name).trim()
    if (v.length < 1) return c.json({ error: "'first_name' is required" }, 400)
    next.first_name = v
  }
  if (body.last_name !== undefined) {
    const v = String(body.last_name).trim()
    if (v.length < 1) return c.json({ error: "'last_name' is required" }, 400)
    next.last_name = v
  }
  if (body.national_code !== undefined) {
    const nc = String(body.national_code).trim()
    if (nc !== '' && !/^\d{10}$/.test(nc)) {
      return c.json({ error: "'national_code' must be 10 digits (or empty)" }, 400)
    }
    next.national_code = nc
  }
  if (body.phone !== undefined) next.phone = String(body.phone).trim()
  if (body.extra_info !== undefined) next.extra_info = String(body.extra_info).trim()

  const name = `${next.first_name} ${next.last_name}`.trim()

  try {
    await c.env.DB.prepare(
      `UPDATE members
       SET first_name = ?, last_name = ?, name = ?, national_code = ?, phone = ?, extra_info = ?
       WHERE id = ?`,
    )
      .bind(next.first_name, next.last_name, name, next.national_code, next.phone, next.extra_info, memberId)
      .run()
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return c.json(
        { error: 'A member with this national code already exists in this institute' },
        409,
      )
    }
    throw err
  }

  return c.json({ ok: true, member: { id: memberId, institute_id: m.institute_id, name, ...next } })
})

// DELETE /api/members/:id — remove a member (and cascade its attendance rows).
app.delete('/members/:id', async (c) => {
  const user = c.get('user')
  const memberId = Number(c.req.param('id'))
  if (!Number.isInteger(memberId)) {
    return c.json({ error: 'Invalid member id' }, 400)
  }

  const loaded = await loadMemberForWrite(c, user, memberId)
  if (loaded.error) return c.json({ error: loaded.error }, loaded.status)

  // Explicitly remove the member's attendance rows first, then the member.
  // (D1 may not enforce ON DELETE CASCADE unless FK pragma is on, so be explicit.)
  const [, delMember] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM attendance WHERE member_id = ?').bind(memberId),
    c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(memberId),
  ])

  return c.json({ ok: true, deleted: delMember.meta?.changes ?? 0 })
})

// GET /api/members/:id/profile — full member profile + attendance stats +
//   per-institute history. Viewable by anyone who can view the member's CURRENT
//   institute (root, its mid_admin branch, its level1_admin, the institute).
app.get('/members/:id/profile', async (c) => {
  const user = c.get('user')
  const memberId = Number(c.req.param('id'))
  if (!Number.isInteger(memberId)) {
    return c.json({ error: 'Invalid member id' }, 400)
  }

  const member = await c.env.DB.prepare(
    `SELECT m.id, m.institute_id, m.first_name, m.last_name, m.name,
            m.national_code, m.phone, m.extra_info, m.created_at,
            i.name AS institute_name
     FROM members m JOIN institutes i ON i.id = m.institute_id
     WHERE m.id = ?`,
  ).bind(memberId).first()
  if (!member) return c.json({ error: 'Member not found' }, 404)

  const institute = await getInstitute(c.env.DB, member.institute_id)
  if (!(await canViewInstitute(c.env.DB, user, institute))) {
    return c.json({ error: 'Forbidden: you cannot view this member' }, 403)
  }

  // Aggregate stats across ALL of the member's attendance (any institute).
  const stats = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present_count,
       SUM(CASE WHEN status = 'absent'  THEN 1 ELSE 0 END) AS absent_count,
       COUNT(*) AS total,
       MAX(date) AS last_date
     FROM attendance WHERE member_id = ?`,
  ).bind(memberId).first()

  // Full per-institute history — each row labels which institute recorded it.
  const historyRes = await c.env.DB.prepare(
    `SELECT a.id, a.date, a.status, a.institute_id, i.name AS institute_name
     FROM attendance a JOIN institutes i ON i.id = a.institute_id
     WHERE a.member_id = ?
     ORDER BY a.date DESC`,
  ).bind(memberId).all()

  return c.json({
    member,
    stats: {
      present_count: stats?.present_count || 0,
      absent_count: stats?.absent_count || 0,
      total: stats?.total || 0,
      last_date: stats?.last_date || null,
    },
    history: historyRes.results ?? [],
  })
})

// ----------------------------------------------------------------------------
// MEMBER TRANSFERS
//
// Attendance history integrity: transferring a member only changes
// members.institute_id. Existing attendance rows keep the institute_id they
// were written with, so a member's past logs stay attributed to the OLD
// institute while new logs attach to the new one.
// ----------------------------------------------------------------------------

/** Resolve an institute login username -> institute_id (or null). */
async function instituteIdByUsername(db, username) {
  const u = await db
    .prepare("SELECT institute_id FROM users WHERE username = ? AND role = 'institute'")
    .bind(String(username))
    .first()
  return u ? u.institute_id : null
}

// POST /api/members/:id/transfer — DIRECT transfer by level1_admin or root.
//   Body: { target_institute_id? , target_institute_username? }
//   level1_admin: must currently supervise the member's institute; may send the
//     member to ANY institute (even outside its branch) by knowing the target's
//     login username. root: unrestricted.
app.post('/members/:id/transfer', async (c) => {
  const user = c.get('user')
  if (user.role !== 'root' && user.role !== 'level1_admin') {
    return c.json({ error: 'Forbidden: only root and level1_admin can transfer members directly' }, 403)
  }

  const memberId = Number(c.req.param('id'))
  if (!Number.isInteger(memberId)) return c.json({ error: 'Invalid member id' }, 400)

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const member = await c.env.DB.prepare(
    'SELECT id, institute_id FROM members WHERE id = ?',
  ).bind(memberId).first()
  if (!member) return c.json({ error: 'Member not found' }, 404)

  // Caller must currently control (manage) the member's source institute.
  const sourceInstitute = await getInstitute(c.env.DB, member.institute_id)
  if (!canManageInstituteMembers(user, sourceInstitute)) {
    return c.json({ error: 'Forbidden: you do not manage this member' }, 403)
  }

  // Resolve destination: prefer explicit id, else look up by institute username.
  let targetId = toInt(body.target_institute_id)
  if (!Number.isInteger(targetId)) {
    if (typeof body.target_institute_username === 'string' && body.target_institute_username.trim()) {
      targetId = await instituteIdByUsername(c.env.DB, body.target_institute_username.trim())
    }
  }
  if (!Number.isInteger(targetId)) {
    return c.json({ error: 'Provide a valid target_institute_id or target_institute_username' }, 400)
  }
  if (targetId === member.institute_id) {
    return c.json({ error: 'Member is already in that institute' }, 400)
  }
  const targetInstitute = await getInstitute(c.env.DB, targetId)
  if (!targetInstitute) return c.json({ error: 'Target institute not found' }, 404)

  // Move the member. Attendance rows are intentionally left untouched.
  await c.env.DB.prepare('UPDATE members SET institute_id = ? WHERE id = ?')
    .bind(targetId, memberId)
    .run()

  return c.json({
    ok: true,
    member_id: memberId,
    from_institute_id: member.institute_id,
    to_institute_id: targetId,
    to_institute_name: targetInstitute.name,
  })
})

// POST /api/transfer-requests — an INSTITUTE requests to move one of its members.
//   Body: { member_id, target_institute_username?, note? }
app.post('/transfer-requests', async (c) => {
  const user = c.get('user')
  if (user.role !== 'institute') {
    return c.json({ error: 'Forbidden: only institutes can request transfers' }, 403)
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const memberId = toInt(body.member_id)
  if (!Number.isInteger(memberId)) return c.json({ error: "Invalid 'member_id'" }, 400)

  const member = await c.env.DB.prepare(
    'SELECT id, institute_id FROM members WHERE id = ?',
  ).bind(memberId).first()
  if (!member || member.institute_id !== user.institute_id) {
    return c.json({ error: 'Member not found in your institute' }, 404)
  }

  // Optional suggested destination (by institute login username).
  let targetId = null
  if (typeof body.target_institute_username === 'string' && body.target_institute_username.trim()) {
    targetId = await instituteIdByUsername(c.env.DB, body.target_institute_username.trim())
    if (!Number.isInteger(targetId)) {
      return c.json({ error: 'Target institute username not found' }, 400)
    }
  }

  // One pending request per member.
  const existing = await c.env.DB.prepare(
    "SELECT id FROM transfer_requests WHERE member_id = ? AND status = 'pending'",
  ).bind(memberId).first()
  if (existing) return c.json({ error: 'A pending transfer request already exists for this member' }, 409)

  const note = typeof body.note === 'string' ? body.note.trim() : null
  const createdAt = new Date().toISOString()

  const result = await c.env.DB.prepare(
    `INSERT INTO transfer_requests
       (member_id, from_institute_id, target_institute_id, requested_by, status, note, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(memberId, user.institute_id, targetId, user.id, note, createdAt).run()

  return c.json({ ok: true, request_id: result.meta?.last_row_id ?? null }, 201)
})

// GET /api/transfer-requests — list requests visible to the caller.
//   institute     -> requests it created (see approve/reject status)
//   level1_admin  -> requests for institutes it supervises (to act on)
//   mid_admin     -> requests within its branch (read-only)
//   root          -> all
app.get('/transfer-requests', async (c) => {
  const user = c.get('user')

  let where = ''
  const binds = []
  if (user.role === 'institute') {
    where = 'WHERE r.from_institute_id = ?'
    binds.push(user.institute_id)
  } else if (user.role === 'level1_admin') {
    where = 'WHERE r.from_institute_id IN (SELECT id FROM institutes WHERE supervisor_id = ?)'
    binds.push(user.id)
  } else if (user.role === 'mid_admin') {
    where = `WHERE r.from_institute_id IN (
               SELECT id FROM institutes WHERE supervisor_id IN (
                 SELECT id FROM users WHERE role = 'level1_admin' AND supervisor_id = ?
               ))`
    binds.push(user.id)
  }
  // root: no filter

  const sql = `
    SELECT r.id, r.member_id, r.from_institute_id, r.target_institute_id,
           r.status, r.note, r.created_at, r.resolved_at,
           m.name AS member_name,
           fi.name AS from_institute_name,
           ti.name AS target_institute_name
    FROM transfer_requests r
    JOIN members m ON m.id = r.member_id
    JOIN institutes fi ON fi.id = r.from_institute_id
    LEFT JOIN institutes ti ON ti.id = r.target_institute_id
    ${where}
    ORDER BY (r.status = 'pending') DESC, r.created_at DESC
  `
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ requests: results ?? [] })
})

// PATCH /api/transfer-requests/:id — approve or reject a pending request.
//   Allowed: root, or the level1_admin supervising the request's from-institute.
//   Body: { action: 'approve'|'reject', target_institute_id?, target_institute_username?, note? }
app.patch('/transfer-requests/:id', async (c) => {
  const user = c.get('user')
  if (user.role !== 'root' && user.role !== 'level1_admin') {
    return c.json({ error: 'Forbidden: only root and level1_admin can resolve requests' }, 403)
  }

  const reqId = Number(c.req.param('id'))
  if (!Number.isInteger(reqId)) return c.json({ error: 'Invalid request id' }, 400)

  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return c.json({ error: "action must be 'approve' or 'reject'" }, 400)
  }

  const reqRow = await c.env.DB.prepare(
    'SELECT id, member_id, from_institute_id, target_institute_id, status FROM transfer_requests WHERE id = ?',
  ).bind(reqId).first()
  if (!reqRow) return c.json({ error: 'Request not found' }, 404)
  if (reqRow.status !== 'pending') {
    return c.json({ error: 'This request has already been resolved' }, 409)
  }

  // The from-institute must be supervised by this level1_admin (root: any).
  const fromInstitute = await getInstitute(c.env.DB, reqRow.from_institute_id)
  if (user.role === 'level1_admin' && (!fromInstitute || fromInstitute.supervisor_id !== user.id)) {
    return c.json({ error: 'Forbidden: you do not supervise this institute' }, 403)
  }

  const resolvedAt = new Date().toISOString()

  if (action === 'reject') {
    await c.env.DB.prepare(
      "UPDATE transfer_requests SET status = 'rejected', resolved_by = ?, resolved_at = ? WHERE id = ?",
    ).bind(user.id, resolvedAt, reqId).run()
    return c.json({ ok: true, status: 'rejected' })
  }

  // approve -> need a destination institute (body overrides the stored suggestion)
  let targetId = toInt(body.target_institute_id)
  if (!Number.isInteger(targetId)) {
    if (typeof body.target_institute_username === 'string' && body.target_institute_username.trim()) {
      targetId = await instituteIdByUsername(c.env.DB, body.target_institute_username.trim())
    } else if (Number.isInteger(reqRow.target_institute_id)) {
      targetId = reqRow.target_institute_id
    }
  }
  if (!Number.isInteger(targetId)) {
    return c.json({ error: 'Approving requires a target institute' }, 400)
  }
  const targetInstitute = await getInstitute(c.env.DB, targetId)
  if (!targetInstitute) return c.json({ error: 'Target institute not found' }, 404)

  // Move the member (history preserved) and mark the request approved atomically.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE members SET institute_id = ? WHERE id = ?').bind(targetId, reqRow.member_id),
    c.env.DB.prepare(
      "UPDATE transfer_requests SET status = 'approved', target_institute_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
    ).bind(targetId, user.id, resolvedAt, reqId),
  ])

  return c.json({ ok: true, status: 'approved', to_institute_id: targetId, to_institute_name: targetInstitute.name })
})

// ----------------------------------------------------------------------------
// ATTENDANCE HISTORY (read) — GET /api/attendance/history
//   Returns recorded attendance rows for institutes the caller may view.
//   Query: institute_id? , from? (YYYY-MM-DD) , to? (YYYY-MM-DD)
//     institute       -> forced to own institute
//     level1_admin    -> only supervised institutes
//     mid_admin        -> supervised institutes (view scope) ; may pass any
//                         institute_id it supervises. To browse others it must
//                         first hold supervision. root -> everything.
// ----------------------------------------------------------------------------
app.get('/attendance/history', async (c) => {
  const user = c.get('user')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const requestedInstitute = c.req.query('institute_id')

  if (from !== undefined && !isValidDateString(from)) {
    return c.json({ error: "Invalid 'from' date" }, 400)
  }
  if (to !== undefined && !isValidDateString(to)) {
    return c.json({ error: "Invalid 'to' date" }, 400)
  }

  // Build the set of institute IDs this user is allowed to read.
  let allowedFilterSql = ''
  const binds = []

  if (requestedInstitute !== undefined) {
    const id = Number(requestedInstitute)
    if (!Number.isInteger(id)) return c.json({ error: "Invalid 'institute_id'" }, 400)
    const institute = await getInstitute(c.env.DB, id)
    if (!(await canViewInstitute(c.env.DB, user, institute))) {
      return c.json({ error: 'Forbidden: you cannot view this institute' }, 403)
    }
    allowedFilterSql = 'a.institute_id = ?'
    binds.push(id)
  } else {
    const scope = instituteScope(user, 'a.institute_id')
    allowedFilterSql = scope.sql
    binds.push(...scope.binds)
  }

  let sql = `
    SELECT
      a.id, a.institute_id, a.member_id, a.date, a.status,
      m.name AS member_name, m.national_code,
      i.name AS institute_name
    FROM attendance a
    JOIN members m ON m.id = a.member_id
    JOIN institutes i ON i.id = a.institute_id
  `
  const where = []
  if (allowedFilterSql) where.push(allowedFilterSql)
  if (from !== undefined) { where.push('a.date >= ?'); binds.push(from) }
  if (to !== undefined) { where.push('a.date <= ?'); binds.push(to) }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY a.date DESC, i.name, m.name'

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ count: (results ?? []).length, records: results ?? [] })
})

// ----------------------------------------------------------------------------
// GET /api/attendance/report — statistical summary of attendance.
//   Query: institute_id? , from? , to?
//   Returns, per member: present_count, absent_count, total_recorded,
//   attendance_rate (present / total, 0..1), plus an overall summary.
//   Visibility is identical to the history endpoint (supervision-scoped).
// ----------------------------------------------------------------------------
app.get('/attendance/report', async (c) => {
  const user = c.get('user')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const requestedInstitute = c.req.query('institute_id')

  if (from !== undefined && !isValidDateString(from)) {
    return c.json({ error: "Invalid 'from' date" }, 400)
  }
  if (to !== undefined && !isValidDateString(to)) {
    return c.json({ error: "Invalid 'to' date" }, 400)
  }

  // Reuse the same scoping rules as history.
  let scopeSql = ''
  const binds = []

  if (requestedInstitute !== undefined) {
    const id = Number(requestedInstitute)
    if (!Number.isInteger(id)) return c.json({ error: "Invalid 'institute_id'" }, 400)
    const institute = await getInstitute(c.env.DB, id)
    if (!(await canViewInstitute(c.env.DB, user, institute))) {
      return c.json({ error: 'Forbidden: you cannot view this institute' }, 403)
    }
    scopeSql = 'a.institute_id = ?'
    binds.push(id)
  } else {
    const scope = instituteScope(user, 'a.institute_id')
    scopeSql = scope.sql
    binds.push(...scope.binds)
  }

  const where = []
  if (scopeSql) where.push(scopeSql)
  if (from !== undefined) { where.push('a.date >= ?'); binds.push(from) }
  if (to !== undefined) { where.push('a.date <= ?'); binds.push(to) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''

  const sql = `
    SELECT
      m.id AS member_id, m.name AS member_name, m.national_code,
      i.id AS institute_id, i.name AS institute_name,
      SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present_count,
      SUM(CASE WHEN a.status = 'absent'  THEN 1 ELSE 0 END) AS absent_count,
      COUNT(a.id) AS total_recorded
    FROM attendance a
    JOIN members m ON m.id = a.member_id
    JOIN institutes i ON i.id = a.institute_id
    ${whereSql}
    GROUP BY m.id
    ORDER BY i.name, m.name
  `

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()

  const rows = (results ?? []).map((r) => {
    const total = r.total_recorded || 0
    return {
      member_id: r.member_id,
      member_name: r.member_name,
      national_code: r.national_code,
      institute_id: r.institute_id,
      institute_name: r.institute_name,
      present_count: r.present_count || 0,
      absent_count: r.absent_count || 0,
      total_recorded: total,
      attendance_rate: total ? Number((r.present_count / total).toFixed(4)) : 0,
    }
  })

  const summary = rows.reduce(
    (acc, r) => {
      acc.present += r.present_count
      acc.absent += r.absent_count
      acc.total += r.total_recorded
      return acc
    },
    { present: 0, absent: 0, total: 0 },
  )
  summary.attendance_rate = summary.total
    ? Number((summary.present / summary.total).toFixed(4))
    : 0

  // Per-day trend (for the line chart): present/absent counts grouped by date.
  const trendSql = `
    SELECT a.date AS date,
      SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN a.status = 'absent'  THEN 1 ELSE 0 END) AS absent,
      COUNT(a.id) AS total
    FROM attendance a
    ${whereSql}
    GROUP BY a.date
    ORDER BY a.date
  `
  const trendRes = await c.env.DB.prepare(trendSql).bind(...binds).all()
  const trend = (trendRes.results ?? []).map((r) => ({
    date: r.date,
    present: r.present || 0,
    absent: r.absent || 0,
    total: r.total || 0,
    attendance_rate: r.total ? Number((r.present / r.total).toFixed(4)) : 0,
  }))

  return c.json({ from: from ?? null, to: to ?? null, summary, members: rows, trend })
})

// ----------------------------------------------------------------------------
// Fallbacks
// ----------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error('API error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// Cloudflare Pages Functions entrypoint. Hono's fetch handles every method.
export const onRequest = (context) => app.fetch(context.request, context.env, context)
