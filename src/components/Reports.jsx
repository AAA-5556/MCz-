import { useState } from 'react'

import { api } from '../lib/api'
import { downloadCsv } from '../lib/csv'
import { useMemberProfile } from '../lib/memberProfileContext'

// --- lightweight native SVG charts (no external deps) ---

/** Vertical bar chart of per-member attendance rate (0..100%). */
function BarChart({ data }) {
  if (!data.length) return null
  const width = Math.max(320, data.length * 48)
  const height = 200
  const pad = 28
  const barW = (width - pad * 2) / data.length
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-full" role="img"
      aria-label="نمودار نرخ حضور اعضا">
      {/* y gridlines at 0/50/100% */}
      {[0, 50, 100].map((g) => {
        const y = height - pad - (g / 100) * (height - pad * 2)
        return (
          <g key={g}>
            <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="currentColor" opacity="0.15" />
            <text x={4} y={y + 4} fontSize="10" fill="currentColor" opacity="0.6">{g}%</text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const h = (d.rate) * (height - pad * 2)
        const x = pad + i * barW + barW * 0.15
        const y = height - pad - h
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW * 0.7} height={h} rx="3"
              fill="var(--fallback-p, oklch(var(--p)))" />
            <title>{d.label}: {Math.round(d.rate * 100)}%</title>
          </g>
        )
      })}
    </svg>
  )
}

/** Line chart of daily attendance rate over the date range. */
function LineChart({ trend }) {
  if (trend.length < 2) return null
  const width = Math.max(320, trend.length * 40)
  const height = 200
  const pad = 30
  const xStep = (width - pad * 2) / (trend.length - 1)
  const yFor = (rate) => height - pad - rate * (height - pad * 2)
  const points = trend.map((t, i) => `${pad + i * xStep},${yFor(t.attendance_rate)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-full" role="img"
      aria-label="روند نرخ حضور در طول زمان">
      {[0, 50, 100].map((g) => {
        const y = height - pad - (g / 100) * (height - pad * 2)
        return (
          <g key={g}>
            <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="currentColor" opacity="0.15" />
            <text x={4} y={y + 4} fontSize="10" fill="currentColor" opacity="0.6">{g}%</text>
          </g>
        )
      })}
      <polyline points={points} fill="none" stroke="var(--fallback-su, oklch(var(--su)))" strokeWidth="2" />
      {trend.map((t, i) => (
        <g key={i}>
          <circle cx={pad + i * xStep} cy={yFor(t.attendance_rate)} r="3"
            fill="var(--fallback-su, oklch(var(--su)))" />
          <title>{t.date}: {Math.round(t.attendance_rate * 100)}%</title>
        </g>
      ))}
    </svg>
  )
}

/**
 * Attendance statistical report: summary tiles, per-member table, CSV export,
 * and native SVG bar + line charts.
 */
export default function Reports({ me, institutes }) {
  const openMember = useMemberProfile()
  const isInstitute = me.role === 'institute'
  const [instituteId, setInstituteId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    setMsg(null)
    try {
      const q = new URLSearchParams()
      if (!isInstitute && instituteId) q.set('institute_id', instituteId)
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      const res = await api.get(`/api/attendance/report?${q.toString()}`)
      setData(res)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const pct = (r) => `${Math.round(r * 100)}%`

  function exportCsv() {
    if (!data) return
    const headers = ['مؤسسه', 'عضو', 'کد ملی', 'حاضر', 'غایب', 'کل', 'نرخ حضور']
    const rows = data.members.map((r) => [
      r.institute_name, r.member_name, r.national_code,
      r.present_count, r.absent_count, r.total_recorded, pct(r.attendance_rate),
    ])
    downloadCsv(`report-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
  }

  const barData = data
    ? data.members.map((r) => ({ label: r.member_name, rate: r.attendance_rate }))
    : []

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
        <button className="btn btn-primary" onClick={run} disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'محاسبه‌ی گزارش'}
        </button>
        <button className="btn btn-outline" onClick={exportCsv} disabled={!data || data.members.length === 0}>
          خروجی CSV
        </button>
      </div>

      {msg && <div className="alert alert-error text-sm"><span>{msg.text}</span></div>}

      {data && (
        <>
          <div className="stats shadow bg-base-100 w-full">
            <div className="stat">
              <div className="stat-title">کل ثبت‌ها</div>
              <div className="stat-value">{data.summary.total}</div>
            </div>
            <div className="stat">
              <div className="stat-title">حاضر</div>
              <div className="stat-value text-success">{data.summary.present}</div>
            </div>
            <div className="stat">
              <div className="stat-title">غایب</div>
              <div className="stat-value text-error">{data.summary.absent}</div>
            </div>
            <div className="stat">
              <div className="stat-title">نرخ حضور کل</div>
              <div className="stat-value">{pct(data.summary.attendance_rate)}</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title">نرخ حضور به تفکیک عضو</h2>
                {barData.length ? <BarChart data={barData} />
                  : <p className="text-base-content/60">داده‌ای نیست.</p>}
              </div>
            </div>
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title">روند نرخ حضور در طول زمان</h2>
                {data.trend && data.trend.length >= 2 ? <LineChart trend={data.trend} />
                  : <p className="text-base-content/60">برای نمودار روند حداقل دو روز داده لازم است.</p>}
              </div>
            </div>
          </div>

          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">گزارش به تفکیک عضو</h2>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      {!isInstitute && <th>مؤسسه</th>}
                      <th>عضو</th>
                      <th>حاضر</th>
                      <th>غایب</th>
                      <th>کل</th>
                      <th>نرخ حضور</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.length === 0 && (
                      <tr><td colSpan={isInstitute ? 5 : 6} className="text-center text-base-content/60">داده‌ای برای این بازه نیست.</td></tr>
                    )}
                    {data.members.map((r) => (
                      <tr key={r.member_id}>
                        {!isInstitute && <td>{r.institute_name}</td>}
                        <td>
                          <button className="link link-primary" onClick={() => openMember(r.member_id)}>
                            {r.member_name}
                          </button>
                        </td>
                        <td className="text-success">{r.present_count}</td>
                        <td className="text-error">{r.absent_count}</td>
                        <td>{r.total_recorded}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <progress className="progress progress-success w-20"
                              value={Math.round(r.attendance_rate * 100)} max="100" />
                            <span className="tabular-nums">{pct(r.attendance_rate)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
