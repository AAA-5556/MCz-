import { useState } from 'react'

import { api } from '../lib/api'

/**
 * Self-service password change, available to every role. Verifies the current
 * password on the backend (PBKDF2) before applying the new one.
 */
export default function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setMsg(null)

    if (next.length < 8) {
      setMsg({ type: 'error', text: 'رمز جدید باید حداقل ۸ کاراکتر باشد.' })
      return
    }
    if (next !== confirm) {
      setMsg({ type: 'error', text: 'رمز جدید و تکرار آن یکسان نیستند.' })
      return
    }

    setBusy(true)
    try {
      await api.patch('/api/me/password', {
        current_password: current,
        new_password: next,
      })
      setMsg({ type: 'success', text: 'رمز عبور با موفقیت تغییر کرد.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card bg-base-100 shadow p-4 gap-3 max-w-md" onSubmit={submit}>
      <h2 className="card-title">تغییر رمز عبور</h2>

      {msg && (
        <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
          <span>{msg.text}</span>
        </div>
      )}

      <label className="form-control">
        <span className="label-text">رمز عبور فعلی</span>
        <input type="password" className="input input-bordered" value={current}
          onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
      </label>

      <label className="form-control">
        <span className="label-text">رمز عبور جدید (حداقل ۸ کاراکتر)</span>
        <input type="password" className="input input-bordered" value={next}
          onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
      </label>

      <label className="form-control">
        <span className="label-text">تکرار رمز عبور جدید</span>
        <input type="password" className="input input-bordered" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
      </label>

      <button className="btn btn-primary self-start" disabled={busy}>
        {busy ? <span className="loading loading-spinner loading-sm" /> : 'تغییر رمز'}
      </button>
    </form>
  )
}
