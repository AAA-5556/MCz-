import { useEffect, useState } from 'react'

import { api, ROLE_LABELS } from '../lib/api'
import { useMemberProfile } from '../lib/memberProfileContext'

const STATUS_BADGE = {
  pending: <span className="badge badge-warning">در انتظار</span>,
  approved: <span className="badge badge-success">تأیید شد</span>,
  rejected: <span className="badge badge-error">رد شد</span>,
}

/**
 * Member transfer requests.
 *  - institute: sees its own requests + their status (incl. "rejected").
 *  - level1_admin / root: can approve (assign destination) or reject pending ones.
 *  - mid_admin: read-only view within its branch.
 */
export default function TransferRequests({ me }) {
  const openMember = useMemberProfile()
  const [requests, setRequests] = useState([])
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(true)

  const canResolve = me.role === 'root' || me.role === 'level1_admin'

  async function load() {
    setLoading(true)
    setMsg(null)
    try {
      const res = await api.get('/api/transfer-requests')
      setRequests(res.requests)
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

  async function approve(r) {
    // Confirm/assign the destination institute by its login username. If the
    // request already suggested one, offer it as the default.
    const target = prompt(
      `تأیید انتقال «${r.member_name}».\n` +
      'نام کاربری مؤسسه‌ی مقصد را وارد کنید' +
      (r.target_institute_name ? ` (پیشنهادی: ${r.target_institute_name})` : '') + ':',
    )
    if (target === null) return
    const payload = { action: 'approve' }
    if (target.trim()) payload.target_institute_username = target.trim()
    setMsg(null)
    try {
      const res = await api.patch(`/api/transfer-requests/${r.id}`, payload)
      setMsg({ type: 'success', text: `«${r.member_name}» به «${res.to_institute_name}» منتقل شد.` })
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  async function reject(r) {
    if (!confirm(`درخواست انتقال «${r.member_name}» رد شود؟`)) return
    setMsg(null)
    try {
      await api.patch(`/api/transfer-requests/${r.id}`, { action: 'reject' })
      setMsg({ type: 'success', text: 'درخواست رد شد.' })
      await load()
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

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">
            درخواست‌های انتقال عضو
            <span className="badge badge-ghost badge-sm mr-2">{ROLE_LABELS[me.role]}</span>
          </h2>
          {loading ? (
            <span className="loading loading-spinner" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>عضو</th>
                    <th>از مؤسسه</th>
                    <th>مقصد پیشنهادی</th>
                    <th>یادداشت</th>
                    <th>وضعیت</th>
                    {canResolve && <th>عملیات</th>}
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 && (
                    <tr><td colSpan={canResolve ? 6 : 5} className="text-center text-base-content/60">درخواستی نیست.</td></tr>
                  )}
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button className="link link-primary" onClick={() => openMember(r.member_id)}>
                          {r.member_name}
                        </button>
                      </td>
                      <td>{r.from_institute_name}</td>
                      <td>{r.target_institute_name || '—'}</td>
                      <td className="max-w-xs truncate">{r.note || '—'}</td>
                      <td>{STATUS_BADGE[r.status]}</td>
                      {canResolve && (
                        <td className="flex gap-2">
                          {r.status === 'pending' ? (
                            <>
                              <button className="btn btn-sm btn-success" onClick={() => approve(r)}>تأیید</button>
                              <button className="btn btn-sm btn-outline btn-error" onClick={() => reject(r)}>رد</button>
                            </>
                          ) : (
                            <span className="opacity-60 text-sm">رسیدگی‌شده</span>
                          )}
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
