import { useEffect, useState } from 'react'

import { api } from '../lib/api'

/**
 * Member profile modal. Fetches /api/members/:id/profile and shows:
 *  - registration details + date joined
 *  - present/absent totals and last attendance date
 *  - a personal attendance history feed labeling the institute for each row.
 *
 * Renders nothing when memberId is falsy. Call with onClose to dismiss.
 */
export default function MemberProfileModal({ memberId, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!memberId) return
    setData(null)
    setErr(null)
    setLoading(true)
    api.get(`/api/members/${memberId}/profile`)
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [memberId])

  if (!memberId) return null

  const m = data?.member
  const s = data?.stats

  // Gregorian ISO -> Persian (Shamsi) date string for display.
  function faDate(iso) {
    if (!iso) return '—'
    try {
      return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric',
      }).format(new Date(iso))
    } catch {
      return iso
    }
  }

  return (
    <div className="modal modal-open" dir="rtl">
      <div className="modal-box max-w-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg">
            {m ? m.name : 'پروفایل عضو'}
          </h3>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>✕</button>
        </div>

        {loading && <span className="loading loading-spinner" />}
        {err && <div className="alert alert-error text-sm"><span>{err}</span></div>}

        {data && (
          <>
            {/* details */}
            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <div><span className="opacity-60">نام:</span> {m.first_name}</div>
              <div><span className="opacity-60">نام خانوادگی:</span> {m.last_name || '—'}</div>
              <div><span className="opacity-60">کد ملی:</span> {m.national_code || '—'}</div>
              <div><span className="opacity-60">تلفن:</span> {m.phone || '—'}</div>
              <div className="col-span-2"><span className="opacity-60">اطلاعات تکمیلی:</span> {m.extra_info || '—'}</div>
              <div><span className="opacity-60">مؤسسه‌ی فعلی:</span> {m.institute_name}</div>
              <div><span className="opacity-60">تاریخ اضافه شدن:</span> {faDate(m.created_at)}</div>
            </div>

            {/* stats */}
            <div className="stats stats-horizontal shadow w-full mb-4 text-center">
              <div className="stat py-2">
                <div className="stat-title">حاضری</div>
                <div className="stat-value text-success text-2xl">{s.present_count}</div>
              </div>
              <div className="stat py-2">
                <div className="stat-title">غایبی</div>
                <div className="stat-value text-error text-2xl">{s.absent_count}</div>
              </div>
              <div className="stat py-2">
                <div className="stat-title">آخرین حضور</div>
                <div className="stat-value text-base font-mono">{s.last_date || '—'}</div>
              </div>
            </div>

            {/* per-institute history feed */}
            <h4 className="font-semibold mb-2">تاریخچه‌ی شخصی حضور و غیاب</h4>
            <div className="max-h-64 overflow-y-auto">
              <table className="table table-sm table-pin-rows">
                <thead>
                  <tr><th>تاریخ</th><th>مؤسسه</th><th>وضعیت</th></tr>
                </thead>
                <tbody>
                  {data.history.length === 0 && (
                    <tr><td colSpan={3} className="text-center opacity-60">سابقه‌ای نیست.</td></tr>
                  )}
                  {data.history.map((h) => (
                    <tr key={h.id}>
                      <td className="font-mono">{h.date}</td>
                      <td>{h.institute_name}</td>
                      <td>
                        {h.status === 'present'
                          ? <span className="badge badge-success">حاضر</span>
                          : <span className="badge badge-error">غایب</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  )
}
