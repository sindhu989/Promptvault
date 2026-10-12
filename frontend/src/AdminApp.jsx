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
  const [activeSection, setActiveSection] = useState('overview')
  const [users, setUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [userStatusFilter, setUserStatusFilter] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [userPagination, setUserPagination] = useState({ page: 1, pages: 0, total: 0 })
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [usersMessage, setUsersMessage] = useState('')
  const [userRefreshKey, setUserRefreshKey] = useState(0)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedUserLoading, setSelectedUserLoading] = useState(false)
  const selectedUserId = selectedUser?.id
  const [prompts, setPrompts] = useState([])
  const [promptSearch, setPromptSearch] = useState('')
  const [promptModerationFilter, setPromptModerationFilter] = useState('')
  const [promptArchivedFilter, setPromptArchivedFilter] = useState('')
  const [promptFeaturedFilter, setPromptFeaturedFilter] = useState('')
  const [promptPage, setPromptPage] = useState(1)
  const [promptPagination, setPromptPagination] = useState({ page: 1, pages: 0, total: 0 })
  const [promptsLoading, setPromptsLoading] = useState(false)
  const [promptsError, setPromptsError] = useState('')
  const [promptsMessage, setPromptsMessage] = useState('')
  const [promptRefreshKey, setPromptRefreshKey] = useState(0)
  const [selectedPrompt, setSelectedPrompt] = useState(null)
  const selectedPromptId = selectedPrompt?.id

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

  useEffect(() => {
    if (!hasSession || !user || activeSection !== 'users') return undefined
    let active = true
    const params = new URLSearchParams({
      page: String(userPage),
      search: userSearch,
      status: userStatusFilter,
      role: userRoleFilter,
    })

    async function loadUsers() {
      setUsersLoading(true)
      setUsersError('')
      try {
        const response = await fetch(`${API_URL}/api/admin/dashboard/users?${params}`, {
          credentials: 'include',
        })
        const data = await response.json()
        if (response.status === 401) {
          if (active) {
            setHasSession(false)
            setUser(null)
            setMessage('Your admin session expired. Sign in again.')
          }
          return
        }
        if (!response.ok) throw new Error(data.message || 'Could not load users.')
        if (active) {
          setUsers(data.users || [])
          setUserPagination(data.pagination || { page: 1, pages: 0, total: 0 })
        }
      } catch (loadError) {
        if (active) setUsersError(loadError.message || 'Could not load users.')
      } finally {
        if (active) setUsersLoading(false)
      }
    }

    const debounce = window.setTimeout(loadUsers, 200)
    return () => {
      active = false
      window.clearTimeout(debounce)
    }
  }, [activeSection, hasSession, user, userPage, userRefreshKey, userRoleFilter, userSearch, userStatusFilter])

  useEffect(() => {
    if (!selectedUserId || !hasSession) return undefined
    let active = true

    async function loadUserDetails() {
      setSelectedUserLoading(true)
      try {
        const response = await fetch(
          `${API_URL}/api/admin/dashboard/users/${encodeURIComponent(selectedUserId)}`,
          { credentials: 'include' },
        )
        const data = await response.json()
        if (response.status === 401) {
          if (active) {
            setHasSession(false)
            setUser(null)
            setMessage('Your admin session expired. Sign in again.')
          }
          return
        }
        if (!response.ok) throw new Error(data.message || 'Could not load user details.')
        if (active) setSelectedUser({ ...data.user, prompts: data.prompts, activity: data.activity })
      } catch (detailError) {
        if (active) setUsersError(detailError.message || 'Could not load user details.')
      } finally {
        if (active) setSelectedUserLoading(false)
      }
    }

    loadUserDetails()
    return () => {
      active = false
    }
  }, [hasSession, selectedUserId, userRefreshKey])

  useEffect(() => {
    if (!hasSession || !user || activeSection !== 'prompts') return undefined
    let active = true
    const params = new URLSearchParams({
      page: String(promptPage),
      search: promptSearch,
      moderationStatus: promptModerationFilter,
      archived: promptArchivedFilter,
      featured: promptFeaturedFilter,
    })

    async function loadPrompts() {
      setPromptsLoading(true)
      setPromptsError('')
      try {
        const response = await fetch(`${API_URL}/api/admin/dashboard/prompts?${params}`, {
          credentials: 'include',
        })
        const data = await response.json()
        if (response.status === 401) {
          if (active) {
            setHasSession(false)
            setUser(null)
            setMessage('Your admin session expired. Sign in again.')
          }
          return
        }
        if (!response.ok) throw new Error(data.message || 'Could not load prompts.')
        if (active) {
          setPrompts(data.prompts || [])
          setPromptPagination(data.pagination || { page: 1, pages: 0, total: 0 })
        }
      } catch (loadError) {
        if (active) setPromptsError(loadError.message || 'Could not load prompts.')
      } finally {
        if (active) setPromptsLoading(false)
      }
    }

    const debounce = window.setTimeout(loadPrompts, 200)
    return () => {
      active = false
      window.clearTimeout(debounce)
    }
  }, [activeSection, hasSession, user, promptPage, promptSearch, promptModerationFilter, promptArchivedFilter, promptFeaturedFilter, promptRefreshKey])

  useEffect(() => {
    if (!selectedPromptId || !hasSession) return undefined
    let active = true
    async function loadPromptDetails() {
      try {
        const response = await fetch(
          `${API_URL}/api/admin/dashboard/prompts/${encodeURIComponent(selectedPromptId)}`,
          { credentials: 'include' },
        )
        const data = await response.json()
        if (response.status === 401) {
          if (active) {
            setHasSession(false)
            setUser(null)
            setMessage('Your admin session expired. Sign in again.')
          }
          return
        }
        if (!response.ok) throw new Error(data.message || 'Could not load prompt details.')
        if (active) setSelectedPrompt(data.prompt)
      } catch (detailError) {
        if (active) setPromptsError(detailError.message || 'Could not load prompt details.')
      }
    }
    loadPromptDetails()
    return () => {
      active = false
    }
  }, [hasSession, selectedPromptId, promptRefreshKey])

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

  async function updateSelectedStatus(userRow, status) {
    if (userRow.status === status) return
    if (!window.confirm(`Change ${userRow.email}'s status to ${status}? Their active sessions may be ended.`)) {
      setUserRefreshKey((current) => current + 1)
      return
    }
    await runUserAction(userRow, `/status`, 'PATCH', { status }, 'User status updated.')
  }

  async function updateSelectedRole(userRow, role) {
    if (userRow.role === role) return
    if (!window.confirm(`Change ${userRow.email}'s role to ${role}?`)) {
      setUserRefreshKey((current) => current + 1)
      return
    }
    await runUserAction(userRow, `/role`, 'PATCH', { role }, 'User role updated.')
  }

  async function runUserAction(userRow, suffix, method, body, successMessage) {
    setUsersError('')
    setUsersMessage('')
    try {
      const response = await fetch(
        `${API_URL}/api/admin/dashboard/users/${encodeURIComponent(userRow.id)}${suffix}`,
        {
          method,
          credentials: 'include',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      )
      const data = await response.json()
      if (response.status === 401) {
        setHasSession(false)
        setUser(null)
        setMessage('Your admin session expired. Sign in again.')
        return
      }
      if (!response.ok) throw new Error(data.message || 'Could not complete the user action.')
      setUsersMessage(data.message || successMessage)
      setUserRefreshKey((current) => current + 1)
      if (selectedUser?.id === userRow.id) setSelectedUser(null)
    } catch (actionError) {
      setUsersError(actionError.message || 'Could not complete the user action.')
      setUserRefreshKey((current) => current + 1)
    }
  }

  function deleteSelectedUser(userRow) {
    const confirmation = window.prompt(
      `This permanently deletes ${userRow.email} and their prompts, collections, and activity. Type DELETE to confirm.`,
    )
    if (confirmation !== 'DELETE') return
    runUserAction(userRow, '', 'DELETE', null, 'User deleted.')
  }

  function resetSelectedUserAccess(userRow) {
    if (!window.confirm(`End every active session for ${userRow.email}?`)) return
    runUserAction(userRow, '/reset-access', 'POST', null, 'User access reset.')
  }

  async function runPromptAction(promptRow, suffix, method, body, successMessage) {
    setPromptsError('')
    setPromptsMessage('')
    try {
      const response = await fetch(
        `${API_URL}/api/admin/dashboard/prompts/${encodeURIComponent(promptRow.id)}${suffix}`,
        {
          method,
          credentials: 'include',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      )
      const data = await response.json()
      if (response.status === 401) {
        setHasSession(false)
        setUser(null)
        setMessage('Your admin session expired. Sign in again.')
        return false
      }
      if (!response.ok) throw new Error(data.message || 'Could not complete the prompt action.')
      setPromptsMessage(data.message || successMessage)
      setPromptRefreshKey((current) => current + 1)
      if (data.prompt && selectedPrompt?.id === promptRow.id) setSelectedPrompt(data.prompt)
      if (method === 'DELETE') setSelectedPrompt(null)
      return true
    } catch (actionError) {
      setPromptsError(actionError.message || 'Could not complete the prompt action.')
      return false
    }
  }

  async function savePromptEdits() {
    if (!selectedPrompt) return
    await runPromptAction(selectedPrompt, '', 'PATCH', {
      title: selectedPrompt.title,
      description: selectedPrompt.description,
      content: selectedPrompt.content,
      category: selectedPrompt.category,
      tags: typeof selectedPrompt.tags === 'string'
        ? selectedPrompt.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : selectedPrompt.tags,
    }, 'Prompt updated.')
  }

  async function moderateSelectedPrompt(promptRow, status) {
    let reason = ''
    if (status === 'rejected') {
      reason = window.prompt('Enter a reason for rejecting this shared prompt:') || ''
      if (!reason.trim()) return
    } else if (!window.confirm(`Approve "${promptRow.title}" for public sharing?`)) {
      return
    }
    await runPromptAction(promptRow, '/moderation', 'PATCH', { status, reason }, `Prompt ${status}.`)
  }

  function deleteSelectedPrompt(promptRow) {
    const confirmation = window.prompt(
      `This permanently deletes "${promptRow.title}" and removes it from collections. Type DELETE to confirm.`,
    )
    if (confirmation !== 'DELETE') return
    runPromptAction(promptRow, '', 'DELETE', null, 'Prompt deleted.')
  }

  return (
    <main className={`admin-page ${user ? 'admin-page-dashboard' : ''}`}>
      <section className={`admin-card ${user ? 'admin-card-dashboard' : ''}`}>
        {!user && (
          <div className="admin-brand">
            <span className="admin-brand-mark" aria-hidden="true">P</span>
            <span>PromptVault <strong>Admin</strong></span>
          </div>
        )}

        {loading ? (
          <p className="admin-status" role="status">Verifying admin session...</p>
        ) : user ? (
          <div className="admin-layout">
            <aside className="admin-sidebar">
              <div className="admin-brand">
                <span className="admin-brand-mark" aria-hidden="true">P</span>
                <span>PromptVault <strong>Admin</strong></span>
              </div>
              <span className="admin-sidebar-label">PLATFORM</span>
              <nav className="admin-nav" aria-label="Admin navigation">
                <button
                  className={`admin-nav-item ${activeSection === 'overview' ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveSection('overview')}
                >
                  <span aria-hidden="true">▦</span> Overview
                </button>
                <button
                  className={`admin-nav-item ${activeSection === 'users' ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveSection('users')}
                >
                  <span aria-hidden="true">♙</span> Users
                </button>
                <button
                  className={`admin-nav-item ${activeSection === 'prompts' ? 'active' : ''}`}
                  type="button"
                  onClick={() => setActiveSection('prompts')}
                >
                  <span aria-hidden="true">✎</span> Prompts
                </button>
              </nav>
              <div className="admin-sidebar-footer">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <button className="admin-secondary-button" type="button" onClick={logout} disabled={pending}>
                  {pending ? 'Signing out...' : 'Sign out'}
                </button>
              </div>
            </aside>
            <section className="admin-main">
              <header className="admin-dashboard-header">
                <div>
                  <span className="admin-kicker">{activeSection === 'overview' ? 'PLATFORM OVERVIEW' : 'PLATFORM MANAGEMENT'}</span>
                  <h1>{activeSection === 'overview' ? 'Admin dashboard' : activeSection === 'users' ? 'User management' : 'Prompt management'}</h1>
                  <p className="admin-description">
                    {activeSection === 'overview'
                      ? 'Platform health and current usage at a glance.'
                      : activeSection === 'users'
                        ? 'Search accounts, manage access, and review user activity.'
                        : 'Review shared prompts, manage visibility, and moderate public content.'}
                  </p>
                </div>
                {activeSection === 'overview' && (
                  <button
                    className="admin-secondary-button"
                    type="button"
                    onClick={() => setDashboardRefreshKey((current) => current + 1)}
                    disabled={dashboardLoading}
                  >
                    {dashboardLoading ? 'Refreshing...' : 'Refresh overview'}
                  </button>
                )}
              </header>
              {activeSection === 'overview' ? (
                <div className="admin-dashboard-content">
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
              ) : activeSection === 'users' ? (
                <section className="admin-users-panel">
                  <div className="admin-users-toolbar">
                    <label className="admin-search">
                      <span className="visually-hidden">Search users</span>
                      <input
                        value={userSearch}
                        onChange={(event) => { setUserSearch(event.target.value); setUserPage(1) }}
                        placeholder="Search by name or email"
                        maxLength={100}
                      />
                    </label>
                    <label>
                      <span className="visually-hidden">Filter by status</span>
                      <select value={userStatusFilter} onChange={(event) => { setUserStatusFilter(event.target.value); setUserPage(1) }}>
                        <option value="">All statuses</option>
                        <option value="active">Active</option>
                        <option value="deactivated">Deactivated</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </label>
                    <label>
                      <span className="visually-hidden">Filter by role</span>
                      <select value={userRoleFilter} onChange={(event) => { setUserRoleFilter(event.target.value); setUserPage(1) }}>
                        <option value="">All roles</option>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                  </div>
                  {usersError && <div className="admin-error" role="alert">{usersError}</div>}
                  {usersMessage && <div className="admin-message" role="status">{usersMessage}</div>}
                  {usersLoading ? (
                    <p className="admin-status" role="status">Loading users...</p>
                  ) : users.length ? (
                    <div className="admin-users-table-wrap">
                      <table className="admin-users-table">
                        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Prompts</th><th>Joined</th><th>Actions</th></tr></thead>
                        <tbody>
                          {users.map((userRow) => (
                            <tr key={userRow.id}>
                              <td>
                                <button className="admin-user-link" type="button" onClick={() => setSelectedUser(userRow)}>
                                  <strong>{userRow.name}</strong><span>{userRow.email}</span>
                                </button>
                              </td>
                              <td>
                                <select
                                  aria-label={`Role for ${userRow.email}`}
                                  value={userRow.role}
                                  disabled={userRow.id === user.id}
                                  onChange={(event) => updateSelectedRole(userRow, event.target.value)}
                                >
                                  <option value="user">User</option><option value="admin">Admin</option>
                                </select>
                              </td>
                              <td>
                                <select
                                  aria-label={`Status for ${userRow.email}`}
                                  value={userRow.status}
                                  disabled={userRow.id === user.id}
                                  onChange={(event) => updateSelectedStatus(userRow, event.target.value)}
                                >
                                  <option value="active">Active</option><option value="deactivated">Deactivated</option><option value="suspended">Suspended</option>
                                </select>
                              </td>
                              <td>{userRow.promptCount}</td>
                              <td>{userRow.createdAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(userRow.createdAt)) : '—'}</td>
                              <td>
                                <div className="admin-user-actions">
                                  <button type="button" onClick={() => setSelectedUser(userRow)}>View</button>
                                  <button type="button" onClick={() => resetSelectedUserAccess(userRow)} disabled={userRow.id === user.id}>Reset access</button>
                                  <button type="button" className="danger" onClick={() => deleteSelectedUser(userRow)} disabled={userRow.id === user.id}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="admin-empty-state">No users match these filters.</p>
                  )}
                  <footer className="admin-pagination">
                    <span>{userPagination.total} accounts · Page {userPagination.pages ? userPagination.page : 0} of {userPagination.pages}</span>
                    <div>
                      <button type="button" onClick={() => setUserPage((page) => Math.max(1, page - 1))} disabled={userPage <= 1 || usersLoading}>Previous</button>
                      <button type="button" onClick={() => setUserPage((page) => Math.min(userPagination.pages, page + 1))} disabled={userPage >= userPagination.pages || usersLoading}>Next</button>
                    </div>
                  </footer>
                  {selectedUser && (
                    <UserDetailsPanel
                      user={selectedUser}
                      loading={selectedUserLoading}
                      onClose={() => setSelectedUser(null)}
                    />
                  )}
                </section>
              ) : (
                <section className="admin-users-panel">
                  <div className="admin-users-toolbar">
                    <label className="admin-search">
                      <span className="visually-hidden">Search prompts</span>
                      <input
                        value={promptSearch}
                        onChange={(event) => { setPromptSearch(event.target.value); setPromptPage(1) }}
                        placeholder="Search title, content, category, or tag"
                        maxLength={100}
                      />
                    </label>
                    <label>
                      <span className="visually-hidden">Filter by moderation status</span>
                      <select value={promptModerationFilter} onChange={(event) => { setPromptModerationFilter(event.target.value); setPromptPage(1) }}>
                        <option value="">All moderation states</option>
                        <option value="pending">Pending review</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </label>
                    <label>
                      <span className="visually-hidden">Filter by archive status</span>
                      <select value={promptArchivedFilter} onChange={(event) => { setPromptArchivedFilter(event.target.value); setPromptPage(1) }}>
                        <option value="">All archive states</option>
                        <option value="false">Active</option>
                        <option value="true">Archived</option>
                      </select>
                    </label>
                    <label>
                      <span className="visually-hidden">Filter by featured status</span>
                      <select value={promptFeaturedFilter} onChange={(event) => { setPromptFeaturedFilter(event.target.value); setPromptPage(1) }}>
                        <option value="">Featured or not</option>
                        <option value="true">Featured</option>
                        <option value="false">Not featured</option>
                      </select>
                    </label>
                  </div>
                  {promptsError && <div className="admin-error" role="alert">{promptsError}</div>}
                  {promptsMessage && <div className="admin-message" role="status">{promptsMessage}</div>}
                  {promptsLoading ? (
                    <p className="admin-status" role="status">Loading prompts...</p>
                  ) : prompts.length ? (
                    <div className="admin-users-table-wrap">
                      <table className="admin-users-table">
                        <thead><tr><th>Prompt</th><th>Owner</th><th>Review</th><th>Visibility</th><th>Updated</th><th>Actions</th></tr></thead>
                        <tbody>
                          {prompts.map((promptRow) => (
                            <tr key={promptRow.id}>
                              <td>
                                <button className="admin-user-link" type="button" onClick={() => setSelectedPrompt(promptRow)}>
                                  <strong>{promptRow.title}</strong><span>{promptRow.category} · {(promptRow.tags || []).join(', ') || 'No tags'}</span>
                                </button>
                              </td>
                              <td>
                                <span className="admin-prompt-owner">{promptRow.owner?.name || 'Unknown owner'}</span>
                                <span className="admin-prompt-owner-email">{promptRow.owner?.email || ''}</span>
                              </td>
                              <td><span className={`admin-review-status ${promptRow.moderationStatus}`}>{promptRow.moderationStatus}</span></td>
                              <td>{promptRow.archived ? 'Archived' : promptRow.isPublic ? 'Shared' : 'Private'}{promptRow.featured ? ' · Featured' : ''}</td>
                              <td>{promptRow.updatedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(promptRow.updatedAt)) : '—'}</td>
                              <td>
                                <div className="admin-user-actions admin-prompt-actions">
                                  <button type="button" onClick={() => setSelectedPrompt(promptRow)}>Review</button>
                                  {promptRow.isPublic && promptRow.moderationStatus !== 'approved' && (
                                    <button type="button" onClick={() => moderateSelectedPrompt(promptRow, 'approved')}>Approve</button>
                                  )}
                                  <button type="button" className="danger" onClick={() => deleteSelectedPrompt(promptRow)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="admin-empty-state">No prompts match these filters.</p>
                  )}
                  <footer className="admin-pagination">
                    <span>{promptPagination.total} prompts · Page {promptPagination.pages ? promptPagination.page : 0} of {promptPagination.pages}</span>
                    <div>
                      <button type="button" onClick={() => setPromptPage((page) => Math.max(1, page - 1))} disabled={promptPage <= 1 || promptsLoading}>Previous</button>
                      <button type="button" onClick={() => setPromptPage((page) => Math.min(promptPagination.pages, page + 1))} disabled={promptPage >= promptPagination.pages || promptsLoading}>Next</button>
                    </div>
                  </footer>
                  {selectedPrompt && (
                    <PromptDetailsPanel
                      prompt={selectedPrompt}
                      onChange={setSelectedPrompt}
                      onClose={() => setSelectedPrompt(null)}
                      onSave={savePromptEdits}
                      onModerate={moderateSelectedPrompt}
                      onFlag={(flag, value) => runPromptAction(selectedPrompt, `/flags/${flag}`, 'PATCH', { value }, 'Prompt status updated.')}
                      onDelete={deleteSelectedPrompt}
                    />
                  )}
                </section>
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

function UserDetailsPanel({ user, loading, onClose }) {
  return (
    <section className="admin-user-details" aria-labelledby="admin-user-details-title">
      <header>
        <div>
          <span className="admin-kicker">ACCOUNT DETAILS</span>
          <h2 id="admin-user-details-title">{user.name}</h2>
          <p>{user.email}</p>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onClose}>Close</button>
      </header>
      <div className="admin-user-summary">
        <span>Role <strong>{user.role}</strong></span>
        <span>Status <strong>{user.status}</strong></span>
        <span>Prompts <strong>{user.promptCount ?? user.prompts?.length ?? 0}</strong></span>
        <span>Joined <strong>{user.createdAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(user.createdAt)) : '—'}</strong></span>
      </div>
      {loading ? (
        <p className="admin-status" role="status">Loading account details...</p>
      ) : (
        <div className="admin-user-details-grid">
          <section>
            <h3>Prompts</h3>
            {user.prompts?.length ? (
              <ul className="admin-detail-list">
                {user.prompts.map((prompt) => (
                  <li key={prompt.id || prompt._id}>
                    <strong>{prompt.title}</strong>
                    <span>{prompt.category} · {prompt.isPublic ? 'Public' : 'Private'}{prompt.archived ? ' · Archived' : ''}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="admin-detail-empty">No prompts found.</p>}
          </section>
          <section>
            <h3>Recent account activity</h3>
            {user.activity?.length ? (
              <ul className="admin-detail-list">
                {user.activity.slice(0, 20).map((item, index) => (
                  <li key={`${item.action}-${item.createdAt}-${index}`}>
                    <strong>{activityLabels[item.action] || item.action}</strong>
                    <span>{item.entityTitle} · {item.createdAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt)) : ''}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="admin-detail-empty">No activity found.</p>}
          </section>
        </div>
      )}
    </section>
  )
}

function PromptDetailsPanel({ prompt, onChange, onClose, onSave, onModerate, onFlag, onDelete }) {
  const update = (field, value) => onChange((current) => ({ ...current, [field]: value }))
  return (
    <section className="admin-user-details admin-prompt-details" aria-labelledby="admin-prompt-details-title">
      <header>
        <div>
          <span className="admin-kicker">PROMPT REVIEW · {prompt.moderationStatus}</span>
          <h2 id="admin-prompt-details-title">{prompt.title}</h2>
          <p>{prompt.owner?.name || 'Unknown owner'} · {prompt.owner?.email || ''}</p>
        </div>
        <button className="admin-secondary-button" type="button" onClick={onClose}>Close</button>
      </header>
      <div className="admin-prompt-edit-grid">
        <label>Title<input value={prompt.title} maxLength={120} onChange={(event) => update('title', event.target.value)} /></label>
        <label>Category<input value={prompt.category} maxLength={80} onChange={(event) => update('category', event.target.value)} /></label>
        <label className="wide">Description<textarea value={prompt.description || ''} maxLength={500} rows={2} onChange={(event) => update('description', event.target.value)} /></label>
        <label className="wide">Tags<input value={Array.isArray(prompt.tags) ? prompt.tags.join(', ') : prompt.tags} onChange={(event) => update('tags', event.target.value)} /></label>
        <label className="wide">Prompt content<textarea value={prompt.content} maxLength={20000} rows={10} onChange={(event) => update('content', event.target.value)} /></label>
      </div>
      {prompt.moderationReason && <p className="admin-rejection-note"><strong>Rejection reason:</strong> {prompt.moderationReason}</p>}
      <div className="admin-prompt-controls">
        <button className="admin-primary-button" type="button" onClick={onSave}>Save edits</button>
        {prompt.isPublic && prompt.moderationStatus !== 'approved' && (
          <button className="admin-secondary-button" type="button" onClick={() => onModerate(prompt, 'approved')}>Approve sharing</button>
        )}
        {prompt.isPublic && (
          <button className="admin-secondary-button" type="button" onClick={() => onModerate(prompt, 'rejected')}>Reject sharing</button>
        )}
        <button className="admin-secondary-button" type="button" onClick={() => onFlag('archived', !prompt.archived)}>
          {prompt.archived ? 'Restore prompt' : 'Archive prompt'}
        </button>
        <button className="admin-secondary-button" type="button" onClick={() => onFlag('featured', !prompt.featured)}>
          {prompt.featured ? 'Unfeature' : 'Feature'}
        </button>
        <button className="admin-secondary-button danger" type="button" onClick={() => onDelete(prompt)}>Delete</button>
      </div>
      <div className="admin-prompt-meta">
        <span>Visibility <strong>{prompt.isPublic ? 'Shared' : 'Private'}</strong></span>
        <span>Versions <strong>{prompt.versionCount || 0}</strong></span>
        <span>Updated <strong>{prompt.updatedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(prompt.updatedAt)) : '—'}</strong></span>
      </div>
    </section>
  )
}

export default AdminApp
