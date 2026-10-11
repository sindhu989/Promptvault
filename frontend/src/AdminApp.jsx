import { useEffect, useState } from 'react'
import './AdminApp.css'

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:5000' : '')
const adminTokenKey = 'promptvault-admin-token'

function AdminApp() {
  const [token, setToken] = useState(() => {
    try {
      return window.sessionStorage.getItem(adminTokenKey) || ''
    } catch {
      return ''
    }
  })
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [bootstrapSecret, setBootstrapSecret] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(token))
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!token) return undefined

    let active = true
    async function loadAdmin() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`${API_URL}/api/admin/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await response.json()
        if (!response.ok) {
          if (response.status === 401) {
            window.sessionStorage.removeItem(adminTokenKey)
            if (active) {
              setToken('')
              setMessage('Your admin session expired. Sign in again.')
            }
            return
          }
          throw new Error(data.message || 'Could not verify the admin session.')
        }
        if (active) setUser(data.user)
      } catch (loadError) {
        if (active) setError(loadError.message || 'Could not verify the admin session.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadAdmin()
    return () => {
      active = false
    }
  }, [token])

  async function submitLogin(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, bootstrapSecret }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Admin sign-in failed.')
      window.sessionStorage.setItem(adminTokenKey, data.token)
      setUser(data.user)
      setToken(data.token)
      setPassword('')
      setBootstrapSecret('')
    } catch (loginError) {
      setError(loginError.message || 'Admin sign-in failed.')
    } finally {
      setPending(false)
    }
  }

  async function logout() {
    setPending(true)
    setError('')
    try {
      const response = await fetch(`${API_URL}/api/admin/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not end the admin session.')
      window.sessionStorage.removeItem(adminTokenKey)
      setToken('')
      setUser(null)
      setMessage('Admin session ended.')
    } catch (logoutError) {
      setError(logoutError.message || 'Could not end the admin session.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="admin-page">
      <section className="admin-card">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">P</span>
          <span>PromptVault <strong>Admin</strong></span>
        </div>

        {loading ? (
          <p className="admin-status" role="status">Verifying admin session...</p>
        ) : user ? (
          <div className="admin-welcome">
            <span className="admin-kicker">SECURE ADMIN ACCESS</span>
            <h1>Welcome, {user.name}</h1>
            <p className="admin-description">
              Signed in as {user.email}. Administrative pages require this verified admin session.
            </p>
            <div className="admin-session-note">
              This session expires automatically after 30 minutes or when you sign out.
            </div>
            <button className="admin-primary-button" type="button" onClick={logout} disabled={pending}>
              {pending ? 'Signing out...' : 'Sign out securely'}
            </button>
          </div>
        ) : (
          <form className="admin-login" onSubmit={submitLogin}>
            <span className="admin-kicker">RESTRICTED AREA</span>
            <h1>Admin sign in</h1>
            <p className="admin-description">
              Use an authorized PromptVault account. First-time setup also requires the
              bootstrap key configured by the server operator.
            </p>
            {message && <div className="admin-message" role="status">{message}</div>}
            {error && <div className="admin-error" role="alert">{error}</div>}
            <label>
              <span>Email address</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Bootstrap key (first admin only)</span>
              <input
                type="password"
                autoComplete="off"
                value={bootstrapSecret}
                onChange={(event) => setBootstrapSecret(event.target.value)}
              />
            </label>
            <button className="admin-primary-button" type="submit" disabled={pending}>
              {pending ? 'Verifying...' : 'Sign in to admin'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}

export default AdminApp
