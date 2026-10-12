import { useEffect, useState } from 'react'
import './AdminApp.css'

const API_URL = import.meta.env.VITE_API_URL || ''
const legacyAdminTokenKey = 'promptvault-admin-token'
const dashboardStats = [
  { key: 'totalUsers', label: 'Total users' },
  { key: 'activeUsers', label: 'Active users · 30 days' },
  { key: 'newUsers', label: 'New users · 30 days' },
  { key: 'totalPrompts', label: 'Total prompts' },
  { key: 'publicPrompts', label: 'Public prompts' },
  { key: 'privatePrompts', label: 'Private prompts' },
  { key: 'totalCollections', label: 'Collections' },
  { key: 'savedTests', label: 'Saved prompt tests' },
  { key: 'recordedCopies', label: 'Recorded prompt copies' },
]
const activityLabels = {
  'prompt.created': 'Created prompt',
  'prompt.updated': 'Updated prompt',
  'prompt.copied': 'Copied prompt',
  'prompt.favorite_added': 'Favorited prompt',
  'prompt.favorite_removed': 'Unfavorited prompt',
  'prompt.sharing_enabled': 'Enabled prompt sharing',
  'prompt.sharing_disabled': 'Disabled prompt sharing',
  'prompt.version_restored': 'Restored prompt version',
  'prompt.duplicated': 'Duplicated prompt',
  'prompt.archived': 'Archived prompt',
  'prompt.restored': 'Restored prompt',
  'prompt.deleted': 'Deleted prompt',
  'prompt.test_saved': 'Saved prompt test',
  'collection.created': 'Created collection',
  'collection.updated': 'Updated collection',
  'collection.deleted': 'Deleted collection',
  'collection.prompt_added': 'Added prompt to collection',
  'collection.prompt_removed': 'Removed prompt from collection',
  'prompts.imported': 'Imported prompt data',
}

function AdminApp() {
  const [hasSession, setHasSession] = useState(true)
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [bootstrapSecret, setBootstrapSecret] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(hasSession)
  const [pending, setPending] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0)

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(legacyAdminTokenKey)
    } catch {}
  }, [])

  useEffect(() => {
    if (!hasSession) return undefined

    let active = true
    async function loadAdmin() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`${API_URL}/api/admin/auth/me`, {
          credentials: 'include',
        })
        const data = await response.json()
        if (!response.ok) {
          if (response.status === 401) {
            if (active) {
              setHasSession(false)
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
  }, [hasSession])

  useEffect(() => {
    if (!hasSession || !user) return undefined
    let active = true

    async function loadDashboard() {
      setDashboardLoading(true)
      setDashboardError('')
      try {
        const response = await fetch(`${API_URL}/api/admin/dashboard`, {
          credentials: 'include',
        })
        const data = await response.json()
        if (!response.ok) {
          if (response.status === 401) {
            if (active) {
              setHasSession(false)
              setUser(null)
              setMessage('Your admin session expired. Sign in again.')
            }
            return
          }
          throw new Error(data.message || 'Could not load dashboard statistics.')
        }
        if (active) setDashboard(data)
      } catch (loadError) {
        if (active) setDashboardError(loadError.message || 'Could not load dashboard statistics.')
      } finally {
        if (active) setDashboardLoading(false)
      }
    }

    loadDashboard()
    const refreshTimer = window.setInterval(loadDashboard, 60_000)
    return () => {
      active = false
      window.clearInterval(refreshTimer)
    }
  }, [dashboardRefreshKey, hasSession, user])

  async function submitLogin(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/api/admin/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, bootstrapSecret }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Admin sign-in failed.')
      setUser(data.user)
      setHasSession(true)
      setPassword('')
      setBootstrapSecret('')
      setDashboard(null)
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
        credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not end the admin session.')
      setHasSession(false)
      setUser(null)
      setDashboard(null)
      setMessage('Admin session ended.')
    } catch (logoutError) {
      setError(logoutError.message || 'Could not end the admin session.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className={`admin-page ${user ? 'admin-page-dashboard' : ''}`}>
      <section className={`admin-card ${user ? 'admin-card-dashboard' : ''}`}>
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">P</span>
          <span>PromptVault <strong>Admin</strong></span>
        </div>

        {loading ? (
          <p className="admin-status" role="status">Verifying admin session...</p>
        ) : user ? (
          <div className="admin-dashboard">
            <header className="admin-dashboard-header">
              <div>
                <span className="admin-kicker">PLATFORM OVERVIEW</span>
                <h1>Admin dashboard</h1>
                <p className="admin-description">
                  Signed in as {user.email}. Admin session expires after 30 minutes.
                </p>
              </div>
              <div className="admin-header-actions">
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => setDashboardRefreshKey((current) => current + 1)}
                  disabled={dashboardLoading}
                >
                  {dashboardLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button className="admin-secondary-button" type="button" onClick={logout} disabled={pending}>
                  {pending ? 'Signing out...' : 'Sign out'}
                </button>
              </div>
            </header>
            {dashboardError && <div className="admin-error" role="alert">{dashboardError}</div>}
            <section className="admin-stats-grid" aria-label="Platform statistics">
              {dashboardStats.map(({ key, label }) => (
                <article className="admin-stat-card" key={key}>
                  <span>{label}</span>
                  <strong>{dashboard ? Number(dashboard.stats[key] || 0).toLocaleString() : dashboardLoading ? '…' : '—'}</strong>
                </article>
              ))}
            </section>
            <section className="admin-activity">
              <div className="admin-section-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>Latest recorded actions across user accounts</p>
                </div>
                {dashboard?.generatedAt && (
                  <span>Updated {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(dashboard.generatedAt))}</span>
                )}
              </div>
              {dashboardLoading && !dashboard ? (
                <p className="admin-status" role="status">Loading platform statistics...</p>
              ) : dashboard?.recentActivity?.length ? (
                <div className="admin-activity-list">
                  {dashboard.recentActivity.map((activity) => (
                    <article className="admin-activity-row" key={activity.id}>
                      <div className="admin-activity-marker" aria-hidden="true">•</div>
                      <div className="admin-activity-copy">
                        <strong>{activityLabels[activity.action] || activity.action}</strong>
                        <span>{activity.entityTitle || activity.entityType}</span>
                      </div>
                      <div className="admin-activity-meta">
                        <span>User {String(activity.userId).slice(-6)}</span>
                        <time dateTime={activity.createdAt}>
                          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.createdAt))}
                        </time>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="admin-empty-state">No recorded activity yet.</p>
              )}
            </section>
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
