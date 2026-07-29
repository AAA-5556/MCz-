import { useState } from 'react'

/**
 * Login page (DaisyUI structure only — styling is yours to refine).
 *
 * On success it calls onLogin(token, user). The token/user shape is whatever
 * your real /api/login returns; here we just POST credentials and pass the
 * result up. Swap the fetch URL/handling for your actual auth endpoint.
 */
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Login failed')
      }
      const data = await res.json()
      onLogin(data.token, data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <form className="card-body" onSubmit={handleSubmit}>
          <h1 className="card-title justify-center text-2xl">Attendance Login</h1>

          {error && (
            <div className="alert alert-error text-sm" role="alert">
              <span>{error}</span>
            </div>
          )}

          <label className="form-control w-full">
            <span className="label-text">Username</span>
            <input
              type="text"
              className="input input-bordered w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label className="form-control w-full">
            <span className="label-text">Password</span>
            <input
              type="password"
              className="input input-bordered w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <div className="card-actions mt-2">
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={loading}
            >
              {loading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                'Sign in'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
