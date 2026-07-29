// Tiny fetch wrapper that attaches the JWT and parses JSON errors.
// The token is read from localStorage on each call so it always reflects login.

export function getToken() {
  return localStorage.getItem('token') || ''
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    // no/invalid JSON body
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),
}

// Human-readable Persian labels for roles.
export const ROLE_LABELS = {
  root: 'روت (مدیر کل)',
  mid_admin: 'ادمین میانی',
  level1_admin: 'ادمین سطح ۱',
  institute: 'مؤسسه',
}

// Which roles a given role is allowed to create (mirrors the backend rule).
//   root -> mid_admin, level1_admin, institute
//   mid_admin -> level1_admin only
//   level1_admin -> institute only
//   institute -> none
export const CREATABLE_ROLES = {
  root: ['mid_admin', 'level1_admin', 'institute'],
  mid_admin: ['level1_admin'],
  level1_admin: ['institute'],
  institute: [],
}

// Today's date in Asia/Tehran as YYYY-MM-DD (matches the backend's clock).
export function todayTehran() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
