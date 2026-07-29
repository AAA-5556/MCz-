import { useEffect, useState } from 'react'

import { api } from '../lib/api'

/**
 * Institutes view.
 *  - root & level1_admin can create institutes (level1_admin becomes supervisor).
 *  - root & mid_admin can transfer an institute to a level1_admin:
 *      root      -> any level1_admin
 *      mid_admin -> only level1_admins within its own branch
 *  - mid_admin sees institutes indirectly (through its level1_admins).
 * (Transferring a level1_admin between mid_admins lives on User Management, root only.)
 */
export default function Institutes({ me, onChanged }) {
  const [institutes, setInstitutes] = useState([])
  const [level1s, setLevel1s] = useState([])
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const canCreate = me.role === 'root' || me.role === 'level1_admin'
  const canTransfer = me.role === 'root' || me.role === 'mid_admin'

  async function load() {
    setLoading(true)
    try {
      const res = await api.get('/api/institutes')
      setInstitutes(res.institutes)
      if (canTransfer) {
        const l = await api.get('/api/users/level1-admins')
        setLevel1s(l.level1_admins)
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

  async function createInstitute(e) {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      await api.post('/api/institutes', { name })
      setName('')
      setMsg({ type: 'success', text: 'مؤسسه ساخته شد.' })
      await load()
      if (onChanged) onChanged()
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function transfer(instituteId, supervisorId) {
    if (!supervisorId) return
    setMsg(null)
    try {
      await api.patch(`/api/institutes/${instituteId}/supervisor`, {
        supervisor_id: Number(supervisorId),
      })
      setMsg({ type: 'success', text: 'مؤسسه به ادمین سطح ۱ منتقل شد.' })
      await load()
      if (onChanged) onChanged()
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
          <span>{msg.text}</span>
        </div>
      )}

      {canCreate && (
        <form className="card bg-base-100 shadow p-4 flex-row items-end gap-3 flex-wrap" onSubmit={createInstitute}>
          <label className="form-control">
            <span className="label-text">نام مؤسسه‌ی جدید</span>
            <input className="input input-bordered" value={name}
              onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <span className="loading loading-spinner loading-sm" /> : 'افزودن مؤسسه'}
          </button>
        </form>
      )}

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">مؤسسه‌ها</h2>
          {loading ? (
            <span className="loading loading-spinner" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>اعضا</th>
                    <th>سازنده</th>
                    <th>ناظر (ادمین سطح ۱)</th>
                    {canTransfer && <th>انتقال به ادمین سطح ۱</th>}
                  </tr>
                </thead>
                <tbody>
                  {institutes.length === 0 && (
                    <tr><td colSpan={canTransfer ? 5 : 4} className="text-center text-base-content/60">مؤسسه‌ای نیست.</td></tr>
                  )}
                  {institutes.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td>{i.member_count}</td>
                      <td>{i.created_by_username || '—'}</td>
                      <td>
                        <span className="badge badge-outline">{i.supervisor_username || 'بدون ناظر'}</span>
                      </td>
                      {canTransfer && (
                        <td>
                          <select
                            className="select select-bordered select-sm"
                            value={i.supervisor_id || ''}
                            onChange={(e) => transfer(i.id, e.target.value)}
                          >
                            <option value="">— انتخاب ناظر —</option>
                            {level1s.map((l) => (
                              <option key={l.id} value={l.id}>{l.username}</option>
                            ))}
                          </select>
                        </td>
                      )}
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
