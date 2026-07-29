import { useEffect, useState } from 'react'

import { api } from '../lib/api'
import { downloadCsv } from '../lib/csv'
import { useMemberProfile } from '../lib/memberProfileContext'

/**
 * Attendance history viewer.
 *  - institute users see only their own institute's records.
 *  - admins see records for institutes they supervise (backend enforced).
 *  - root sees everything.
 * Optional institute filter + date range (from/to).
 */
export default function History({ me, institutes }) {
  const openMember = useMemberProfile()
  const isInstitute = me.role === 'institute'
  const [instituteId, setInstituteId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [records, setRecords] = useState([])
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    setMsg(null)
    try {
      const q = new URLSearchParams()
      if (!isInstitute && instituteId) q.set('institute_id', instituteId)
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      const res = await api.get(`/api/attendance/history?${q.toString()}`)
      setRecords(res.records)
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

  function exportCsv() {
    const headers = ['تاریخ', 'مؤسسه', 'عضو', 'کد ملی', 'وضعیت']
    const rows = records.map((r) => [
      r.date,
      r.institute_name,
      r.member_name,
      r.national_code,
      r.status === 'present' ? 'حاضر' : 'غایب',
    ])
    downloadCsv(`history-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {!isInstitute && (
          <label className="form-control">
            <span className="label-text">مؤسسه (اختیاری)</span>
            <select className="select select-bordered" value={instituteId}
              onChange={(e) => setInstituteId(e.target.value)}>
              <option value="">همه‌ی مؤسسه‌های تحت نظارت</option>
              {institutes.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="form-control">
          <span className="label-text">از تاریخ</span>
          <input type="date" className="input input-bordered" value={from}
            onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="form-control">
          <span className="label-text">تا تاریخ</span>
          <input type="date" className="input input-bordered" value={to}
            onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={load} disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'نمایش تاریخچه'}
        </button>
        <button className="btn btn-outline" onClick={exportCsv} disabled={records.length === 0}>
          خروجی CSV
        </button>
      </div>

      {msg && (
        <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
          <span>{msg.text}</span>
        </div>
      )}

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">تاریخچه‌ی حضور و غیاب ({records.length} رکورد)</h2>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>تاریخ</th>
                  {!isInstitute && <th>مؤسسه</th>}
                  <th>عضو</th>
                  <th>کد ملی</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 && (
                  <tr><td colSpan={isInstitute ? 4 : 5} className="text-center text-base-content/60">رکوردی یافت نشد.</td></tr>
                )}
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono">{r.date}</td>
                    {!isInstitute && <td>{r.institute_name}</td>}
                    <td>
                      <button className="link link-primary" onClick={() => openMember(r.member_id)}>
                        {r.member_name}
                      </button>
                    </td>
                    <td>{r.national_code}</td>
                    <td>
                      {r.status === 'present'
                        ? <span className="badge badge-success">حاضر</span>
                        : <span className="badge badge-error">غایب</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
