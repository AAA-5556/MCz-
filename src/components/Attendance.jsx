import { useEffect, useState } from 'react'

import { api, todayTehran } from '../lib/api'
import { useMemberProfile } from '../lib/memberProfileContext'

/**
 * Daily attendance marking.
 *  - institute users mark their own members for TODAY (Asia/Tehran).
 *  - admins/root can view any date for institutes they supervise (read-only
 *    here; past-day editing is locked by the backend anyway).
 */
export default function Attendance({ me, institutes }) {
  const openMember = useMemberProfile()
  const isInstitute = me.role === 'institute'
  const today = todayTehran()
  const [date, setDate] = useState(today)
  const [instituteId, setInstituteId] = useState(
    isInstitute ? String(me.institute_id) : '',
  )
  const [rows, setRows] = useState([])
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  const isToday = date === today
  const canEdit = isInstitute && isToday

  async function load() {
    const scopeReady = isInstitute || instituteId
    if (!scopeReady) { setRows([]); return }
    setLoading(true)
    setMsg(null)
    try {
      const q = new URLSearchParams({ date })
      if (!isInstitute && instituteId) q.set('institute_id', instituteId)
      const res = await api.get(`/api/attendance?${q.toString()}`)
      setRows(res.members)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, instituteId])

  async function mark(member_id, status) {
    setMsg(null)
    try {
      await api.post('/api/attendance', { member_id, date, status })
      setRows((prev) =>
        prev.map((r) => (r.member_id === member_id ? { ...r, status } : r)),
      )
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="form-control">
          <span className="label-text">تاریخ</span>
          <input type="date" className="input input-bordered" value={date}
            max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        {!isInstitute && (
          <label className="form-control">
            <span className="label-text">مؤسسه</span>
            <select className="select select-bordered" value={instituteId}
              onChange={(e) => setInstituteId(e.target.value)}>
              <option value="">— انتخاب مؤسسه —</option>
              {institutes.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>
        )}
        {!isToday && (
          <div className="badge badge-warning gap-1 self-center">
            روزهای گذشته قفل هستند (فقط مشاهده)
          </div>
        )}
      </div>

      {msg && (
        <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
          <span>{msg.text}</span>
        </div>
      )}

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">حضور و غیاب — {date}</h2>
          {loading ? (
            <span className="loading loading-spinner" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>نام</th><th>کد ملی</th><th>وضعیت</th>{canEdit && <th>ثبت</th>}</tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={canEdit ? 4 : 3} className="text-center text-base-content/60">داده‌ای نیست.</td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.member_id}>
                      <td>
                        <button className="link link-primary" onClick={() => openMember(r.member_id)}>
                          {r.name}
                        </button>
                      </td>
                      <td>{r.national_code}</td>
                      <td>
                        {r.status === 'present' && <span className="badge badge-success">حاضر</span>}
                        {r.status === 'absent' && <span className="badge badge-error">غایب</span>}
                        {!r.status && <span className="badge badge-ghost">ثبت‌نشده</span>}
                      </td>
                      {canEdit && (
                        <td className="flex gap-2">
                          <button className={`btn btn-sm ${r.status === 'present' ? 'btn-success' : 'btn-outline'}`}
                            onClick={() => mark(r.member_id, 'present')}>حاضر</button>
                          <button className={`btn btn-sm ${r.status === 'absent' ? 'btn-error' : 'btn-outline'}`}
                            onClick={() => mark(r.member_id, 'absent')}>غایب</button>
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
