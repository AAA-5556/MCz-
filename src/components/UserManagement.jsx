import { useEffect, useState } from 'react'

import { api, ROLE_LABELS } from '../lib/api'

/**
 * User Management page.
 *   root         -> sees all users; can delete, reset password, and transfer a
 *                   level1_admin between mid_admins.
 *   mid_admin    -> sees its level1_admins; delete + reset password.
 *   level1_admin -> sees its institute users; delete + reset password.
 */
export default function UserManagement({ me }) {
  const [users, setUsers] = useState([])
  const [selfId, setSelfId] = useState(null)
  const [midAdmins, setMidAdmins] = useState([])
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setMsg(null)
    try {
      const res = await api.get('/api/users')
      setUsers(res.users)
      setSelfId(res.self_id)
      if (me.role === 'root') {
        const m = await api.get('/api/users/mid-admins')
        setMidAdmins(m.mid_admins)
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resetPassword(u) {
    const pw = prompt(`رمز جدید برای «${u.username}» (حداقل ۸ کاراکتر):`)
    if (!pw) return
    setMsg(null)
    try {
      await api.patch(`/api/users/${u.id}/password`, { password: pw })
      setMsg({ type: 'success', text: `رمز «${u.username}» تغییر کرد.` })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  async function deleteUser(u) {
    if (!confirm(`کاربر «${u.username}» حذف شود؟`)) return
    setMsg(null)
    try {
      await api.del(`/api/users/${u.id}`)
      setMsg({ type: 'success', text: `کاربر «${u.username}» حذف شد.` })
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  async function transferSupervisor(u, supervisorId) {
    setMsg(null)
    try {
      await api.patch(`/api/users/${u.id}/supervisor`, {
        supervisor_id: supervisorId ? Number(supervisorId) : null,
      })
      setMsg({ type: 'success', text: `ناظرِ «${u.username}» به‌روزرسانی شد.` })
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  const isRoot = me.role === 'root'

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
          <span>{msg.text}</span>
        </div>
      )}

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">کاربران تحت مدیریت شما</h2>
          {loading ? (
            <span className="loading loading-spinner" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>نام کاربری</th>
                    <th>نقش</th>
                    <th>مؤسسه</th>
                    <th>ناظر</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-base-content/60">کاربری نیست.</td></tr>
                  )}
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.username}
                        {u.id === selfId && <span className="badge badge-ghost badge-sm mr-2">شما</span>}
                      </td>
                      <td>{ROLE_LABELS[u.role] || u.role}</td>
                      <td>{u.institute_name || '—'}</td>
                      <td>
                        {/* root can reassign a level1_admin's mid_admin supervisor inline */}
                        {isRoot && u.role === 'level1_admin' ? (
                          <select
                            className="select select-bordered select-sm"
                            value={u.supervisor_id || ''}
                            onChange={(e) => transferSupervisor(u, e.target.value)}
                          >
                            <option value="">— بدون ناظر —</option>
                            {midAdmins.map((m) => (
                              <option key={m.id} value={m.id}>{m.username}</option>
                            ))}
                          </select>
                        ) : (
                          u.supervisor_username || '—'
                        )}
                      </td>
                      <td className="flex gap-2">
                        <button className="btn btn-sm btn-outline" onClick={() => resetPassword(u)}>
                          تغییر رمز
                        </button>
                        {u.id !== selfId && (
                          <button className="btn btn-sm btn-outline btn-error" onClick={() => deleteUser(u)}>
                            حذف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
