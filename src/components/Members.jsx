import { useEffect, useState } from 'react'

import { api } from '../lib/api'
import { useMemberProfile } from '../lib/memberProfileContext'

/**
 * Members management for a single institute.
 *  - institute users manage their own institute (no picker shown).
 *  - root & the direct level1_admin can add/edit/delete + transfer members.
 *  - mid_admin is READ-ONLY (can view members for reports, not modify).
 *  - institute users can request a transfer for their own members.
 * Clicking a member's name opens the shared profile modal.
 */
export default function Members({ me, institutes }) {
  const openMember = useMemberProfile()
  const isInstitute = me.role === 'institute'
  const canWrite = me.role !== 'mid_admin' // mid_admin is read-only
  const canDirectTransfer = me.role === 'root' || me.role === 'level1_admin'
  const canRequestTransfer = me.role === 'institute'

  const [instituteId, setInstituteId] = useState(
    isInstitute ? String(me.institute_id) : '',
  )
  const [members, setMembers] = useState([])
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  // create form
  const [form, setForm] = useState({ first_name: '', last_name: '', national_code: '', phone: '', extra_info: '' })
  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function load(id) {
    if (!id) { setMembers([]); return }
    setLoading(true)
    try {
      const q = isInstitute ? '' : `?institute_id=${id}`
      const res = await api.get(`/api/members${q}`)
      setMembers(res.members)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(instituteId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instituteId])

  async function addMember(e) {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      const payload = { ...form }
      if (!isInstitute) payload.institute_id = Number(instituteId)
      await api.post('/api/members', payload)
      setForm({ first_name: '', last_name: '', national_code: '', phone: '', extra_info: '' })
      setMsg({ type: 'success', text: 'عضو اضافه شد.' })
      await load(instituteId)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  // --- edit ---
  const [editing, setEditing] = useState(null)
  const [edit, setEdit] = useState({})
  function startEdit(m) {
    setEditing(m.id)
    setEdit({
      first_name: m.first_name || '',
      last_name: m.last_name || '',
      national_code: m.national_code || '',
      phone: m.phone || '',
      extra_info: m.extra_info || '',
    })
    setMsg(null)
  }
  async function saveEdit(id) {
    setMsg(null)
    try {
      await api.patch(`/api/members/${id}`, edit)
      setEditing(null)
      setMsg({ type: 'success', text: 'عضو ویرایش شد.' })
      await load(instituteId)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }
  async function removeMember(m) {
    if (!confirm(`عضو «${m.name}» و همه‌ی سوابق حضورش حذف شود؟`)) return
    setMsg(null)
    try {
      await api.del(`/api/members/${m.id}`)
      setMsg({ type: 'success', text: 'عضو حذف شد.' })
      await load(instituteId)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  // --- direct transfer (level1_admin / root) ---
  async function directTransfer(m) {
    const target = prompt(
      `انتقال «${m.name}» به مؤسسه‌ی دیگر.\n` +
      'نام کاربری مؤسسه‌ی مقصد را وارد کنید.\n' +
      '⚠️ اگر مؤسسه‌ی مقصد خارج از شاخه‌ی شما باشد، کنترل این عضو را از دست می‌دهید.',
    )
    if (!target) return
    setMsg(null)
    try {
      const res = await api.post(`/api/members/${m.id}/transfer`, {
        target_institute_username: target.trim(),
      })
      setMsg({ type: 'success', text: `«${m.name}» به «${res.to_institute_name}» منتقل شد. سوابق حضور حفظ شد.` })
      await load(instituteId)
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  // --- request transfer (institute) ---
  async function requestTransfer(m) {
    const target = prompt(
      `درخواست انتقال «${m.name}».\n` +
      'در صورت تمایل، نام کاربری مؤسسه‌ی مقصد پیشنهادی را وارد کنید (اختیاری).',
    )
    // prompt returns null if cancelled; '' means "no suggestion".
    if (target === null) return
    setMsg(null)
    try {
      const payload = { member_id: m.id }
      if (target.trim()) payload.target_institute_username = target.trim()
      await api.post('/api/transfer-requests', payload)
      setMsg({ type: 'success', text: 'درخواست انتقال ثبت شد و برای تأیید به ادمین سطح ۱ ارسال شد.' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
  }

  const showActions = canWrite || canDirectTransfer || canRequestTransfer

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
          <span>{msg.text}</span>
        </div>
      )}

      {!isInstitute && (
        <label className="form-control max-w-xs">
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

      {instituteId && (
        <>
          {canWrite && (
            <form className="card bg-base-100 shadow p-4 gap-3" onSubmit={addMember}>
              <h3 className="font-semibold">افزودن عضو جدید</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input input-bordered" placeholder="نام *" required
                  value={form.first_name} onChange={(e) => setField('first_name', e.target.value)} />
                <input className="input input-bordered" placeholder="نام خانوادگی *" required
                  value={form.last_name} onChange={(e) => setField('last_name', e.target.value)} />
                <input className="input input-bordered" placeholder="کد ملی (اختیاری، ۱۰ رقم)" inputMode="numeric"
                  value={form.national_code} onChange={(e) => setField('national_code', e.target.value)} />
                <input className="input input-bordered" placeholder="شماره تلفن (اختیاری)" inputMode="tel"
                  value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
                <textarea className="textarea textarea-bordered sm:col-span-2" placeholder="اطلاعات تکمیلی (اختیاری)"
                  value={form.extra_info} onChange={(e) => setField('extra_info', e.target.value)} />
              </div>
              <button className="btn btn-primary self-start" disabled={busy}>
                {busy ? <span className="loading loading-spinner loading-sm" /> : 'افزودن عضو'}
              </button>
            </form>
          )}

          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <h2 className="card-title">
                اعضا
                {!canWrite && <span className="badge badge-ghost badge-sm mr-2">فقط مشاهده</span>}
              </h2>
              {loading ? (
                <span className="loading loading-spinner" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr><th>#</th><th>نام</th><th>کد ملی</th><th>تلفن</th>{showActions && <th>عملیات</th>}</tr>
                    </thead>
                    <tbody>
                      {members.length === 0 && (
                        <tr><td colSpan={showActions ? 5 : 4} className="text-center text-base-content/60">عضوی ثبت نشده.</td></tr>
                      )}
                      {members.map((m, idx) => (
                        <tr key={m.id}>
                          <td>{idx + 1}</td>
                          {canWrite && editing === m.id ? (
                            <>
                              <td>
                                <div className="flex gap-1">
                                  <input className="input input-bordered input-sm w-24" placeholder="نام"
                                    value={edit.first_name} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} />
                                  <input className="input input-bordered input-sm w-24" placeholder="خانوادگی"
                                    value={edit.last_name} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} />
                                </div>
                              </td>
                              <td>
                                <input className="input input-bordered input-sm w-28" value={edit.national_code}
                                  onChange={(e) => setEdit({ ...edit, national_code: e.target.value })} />
                              </td>
                              <td>
                                <input className="input input-bordered input-sm w-28" value={edit.phone}
                                  onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                              </td>
                              <td className="flex gap-2">
                                <button className="btn btn-sm btn-success" onClick={() => saveEdit(m.id)}>ذخیره</button>
                                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>لغو</button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <button className="link link-primary" onClick={() => openMember(m.id)}>
                                  {m.name}
                                </button>
                              </td>
                              <td>{m.national_code || '—'}</td>
                              <td>{m.phone || '—'}</td>
                              {showActions && (
                                <td className="flex flex-wrap gap-2">
                                  {canWrite && (
                                    <>
                                      <button className="btn btn-sm btn-outline" onClick={() => startEdit(m)}>ویرایش</button>
                                      <button className="btn btn-sm btn-outline btn-error" onClick={() => removeMember(m)}>حذف</button>
                                    </>
                                  )}
                                  {canDirectTransfer && (
                                    <button className="btn btn-sm btn-outline btn-warning" onClick={() => directTransfer(m)}>انتقال</button>
                                  )}
                                  {canRequestTransfer && (
                                    <button className="btn btn-sm btn-outline btn-info" onClick={() => requestTransfer(m)}>درخواست انتقال</button>
                                  )}
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
