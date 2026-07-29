import { useState } from 'react'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

/**
 * App shell — swaps between the login page and the dashboard based on whether
 * we hold an auth token. Persists to localStorage so a refresh keeps you in.
 */
function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '')
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw) : null
  })

  function handleLogin(newToken, newUser) {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
  }

  function handleLogout() {
    setToken('')
    setUser(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  if (!token) {
    return <Login onLogin={handleLogin} />
  }

  return <Dashboard user={user} token={token} onLogout={handleLogout} />
}

export default App
