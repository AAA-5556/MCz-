import { useEffect, useState } from 'react'

import { api, ROLE_LABELS, CREATABLE_ROLES } from '../lib/api'

/**
 * Create-user form. Shows only roles the current user may create.
 *  - display_name: optional Persian name (for an institute account this becomes
 *    the new institute's name).
 *  - institute role: linking to an EXISTING institute is OPTIONAL. If left on
 *    "new institute", the backend auto-creates one named after the display name
 *    (or username), owned by the creating level1_admin.
 *  - level1_admin by root: optionally pick a mid_admin supervisor.
 * The backend re-enforces every rule.
 */
export default function CreateUser({ me, institutes, onCreated }) {
  const allowedRoles = CREATABLE_ROLES[me.role] || []
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(allowedRoles[0] || '')
  const [instituteId, setInstituteId] = useState('') // '' = create a new institute
  const [supervisorId, setSupervisorId] = useState('')
  const [midAdmins, setMidAdmins] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  // root needs the list of mid_admins to (optionally) assign as supervisor.
  useEffect(() => {
    if (me.role === 'root') {
      api.get('/api/users/mid-admins')
        .then((r) => setMidAdmins(r.mid_admins))
        .catch(() => setMidAdmins([]))
    }
  }, [me.role])

  if (allowedRoles.length === 0) {
    return (
      <div className="alert alert-info">
        <span>نقش شما اجازه‌ی ساخت کاربر جدید را ندارد.</span>
      </div>
    )
  }

  async function submit(e) {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      const payload = { username, password, role }
      if (displayName.trim()) payload.display_name = displayName.trim()
      // institute_id is OPTIONAL — only send it when linking to an existing one.
      if (role === 'institute' && instituteId) payload.institute_id = Number(instituteId)
      if (role === 'level1_admin' && me.role === 'root' && supervisorId) {
        payload.supervisor_id = Number(supervisorId)
      }
      const res = await api.post('/api/users', payload)
      setMsg({ type: 'success', text: `کاربر «${res.user.username}» ساخته شد.` })
      setUsername('')
      setDisplayName('')
      setPassword('')
      setInstituteId('')
      if (onCreated) onCreated()
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card bg-base-100 shadow p-4 gap-3 max-w-lg" onSubmit={submit}>
      <h2 className="card-title">ساخت کاربر جدید</h2>

      {msg && (
        <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
          <span>{msg.text}</span>
        </div>
      )}

      <label className="form-control">
        <span className="label-text">نام کاربری (لاتین)</span>
        <input className="input input-bordered" value={username}
          onChange={(e) => setUsername(e.target.value)} required minLength={3} />
      </label>

      <label className="form-control">
        <span className="label-text">
          نام نمایشی {role === 'institute' ? '(نام مؤسسه — مثلاً «دبستان نبوت»)' : '(مثلاً «علی رضایی»)'}
        </span>
        <input className="input input-bordered" value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="اختیاری" />
      </label>

      <label className="form-control">
        <span className="label-text">رمز عبور (حداقل ۸ کاراکتر)</span>
        <input type="password" className="input input-bordered" value={password}
          onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>

      <label className="form-control">
        <span className="label-text">نقش</span>
        <select className="select select-bordered" value={role}
          onChange={(e) => setRole(e.target.value)}>
          {allowedRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </label>

      {role === 'institute' && (
        <label className="form-control">
          <span className="label-text">اتصال به مؤسسه (اختیاری)</span>
          <select className="select select-bordered" value={instituteId}
            onChange={(e) => setInstituteId(e.target.value)}>
            <option value="">— ساخت مؤسسه‌ی جدید با همین نام —</option>
            {institutes.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <span className="label-text-alt opacity-60 mt-1">
            اگر خالی بماند، یک مؤسسه‌ی جدید ساخته و به این حساب وصل می‌شود.
          </span>
        </label>
      )}

      {role === 'level1_admin' && me.role === 'root' && (
        <label className="form-control">
          <span className="label-text">ناظر (ادمین میانی) — اختیاری</span>
          <select className="select select-bordered" value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}>
            <option value="">— بدون ناظر —</option>
            {midAdmins.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name || m.username}</option>
            ))}
          </select>
        </label>
      )}

      <button className="btn btn-primary" disabled={busy}>
        {busy ? <span className="loading loading-spinner loading-sm" /> : 'ساخت کاربر'}
      </button>
    </form>
  )
}
