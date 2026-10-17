import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_URL =
  import.meta.env.VITE_API_URL || ''
const userKey = 'promptvault-user'

function readStoredValue(key) {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function formatDate(date) {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(date))
}

function formatActivityDate(date) {
  const value = new Date(date)
  if (Number.isNaN(value.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

const activityLabels = {
  'prompt.created': 'Created prompt',
  'prompt.updated': 'Updated prompt',
  'prompt.favorite_added': 'Added prompt to favorites',
  'prompt.favorite_removed': 'Removed prompt from favorites',
  'prompt.sharing_enabled': 'Enabled prompt sharing',
  'prompt.sharing_disabled': 'Disabled prompt sharing',
  'prompt.version_restored': 'Restored a prompt version',
  'prompt.duplicated': 'Duplicated prompt',
  'prompt.archived': 'Archived prompt',
  'prompt.restored': 'Restored prompt',
  'prompt.deleted': 'Deleted prompt',
  'prompt.test_saved': 'Saved prompt test result',
  'collection.created': 'Created collection',
  'collection.updated': 'Updated collection',
  'collection.deleted': 'Deleted collection',
  'collection.prompt_added': 'Added prompt to collection',
  'collection.prompt_removed': 'Removed prompt from collection',
  'prompts.imported': 'Imported prompt data',
}

function promptVariables(content) {
  return [...new Set([...content.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g)].map((match) => match[1]))]
}

function App() {
  const [user, setUser] = useState(() => readStoredValue(userKey))
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [resetOtp, setResetOtp] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [authMessage, setAuthMessage] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [authForm, setAuthForm] = useState({
    name: '',
    email: '',
    password: '',
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [prompts, setPrompts] = useState([])
  const [collections, setCollections] = useState([])
  const [activities, setActivities] = useState([])
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activityRefreshKey, setActivityRefreshKey] = useState(0)
  const [activeCategory, setActiveCategory] = useState('All prompts')
  const [selectedCollection, setSelectedCollection] = useState(null)
  const [collectionPromptIds, setCollectionPromptIds] = useState([])
  const [collectionDialog, setCollectionDialog] = useState(false)
  const [promptToCollect, setPromptToCollect] = useState(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('recent')
  const [editingPrompt, setEditingPrompt] = useState(null)
  const [isCreating, setIsCreating] = useState(false)
  const [historyPrompt, setHistoryPrompt] = useState(null)
  const [versions, setVersions] = useState([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [testerPrompt, setTesterPrompt] = useState(null)
  const [testVariables, setTestVariables] = useState({})
  const [testResult, setTestResult] = useState(null)
  const [savedTestRuns, setSavedTestRuns] = useState([])
  const [compareRunId, setCompareRunId] = useState('')
  const [runningTest, setRunningTest] = useState(false)
  const [savingTest, setSavingTest] = useState(false)
  const [profileDialog, setProfileDialog] = useState(false)
  const [transferFormat, setTransferFormat] = useState('json')
  const [transferringData, setTransferringData] = useState(false)
  const importInputRef = useRef(null)
  const sharedRoute = window.location.pathname.match(/^\/share\/(prompt|collection)\/([^/]+)$/)
  const featuredRoute = window.location.pathname === '/discover'

  useEffect(() => {
    try {
      window.localStorage.removeItem('promptvault-token')
    } catch {}

    if (/^\/share\/(prompt|collection)\/[^/]+$/.test(window.location.pathname) || featuredRoute) return undefined

    let active = true
    async function restoreSession() {
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: 'include',
        })
        const data = await response.json()
        if (!active) return
        if (response.status === 401) {
          window.localStorage.removeItem(userKey)
          setUser(null)
          return
        }
        if (!response.ok) throw new Error(data.message || 'Could not verify your session.')
        setUser(data.user)
        setIsAuthenticated(true)
        try {
          window.localStorage.setItem(userKey, JSON.stringify(data.user))
        } catch {}
      } catch (sessionError) {
        if (active) setError(sessionError.message || 'Could not verify your session.')
      } finally {
        if (active) setSessionChecked(true)
      }
    }

    restoreSession()
    return () => {
      active = false
    }
  }, [featuredRoute])

  useEffect(() => {
    document.documentElement.dataset.theme = user?.theme === 'dark' ? 'dark' : 'light'
  }, [user?.theme])

  useEffect(() => {
    if (!isAuthenticated) return

    async function loadPrompts() {
      setLoadingPrompts(true)
      try {
        const response = await fetch(`${API_URL}/api/prompts`, {
          credentials: 'include',
        })

        const data = await response.json()
        if (!response.ok) {
          if (response.status === 401) {
            logout()
            throw new Error('Your session expired or is no longer valid. Log in again.')
          }
          throw new Error(data.message || 'Could not load prompts.')
        }

        setPrompts(data.prompts || [])
        const collectionData = await fetch(`${API_URL}/api/collections`, {
          credentials: 'include',
        })
        const collectionBody = await collectionData.json()
        if (!collectionData.ok) {
          throw new Error(collectionBody.message || 'Could not load collections.')
        }
        setCollections(collectionBody.collections || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setLoadingPrompts(false)
      }
    }

    loadPrompts()
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || activeCategory !== 'Activity') return undefined
    let active = true

    async function loadActivity() {
      setLoadingActivity(true)
      setError('')
      try {
        const response = await fetch(`${API_URL}/api/activity`, {
          credentials: 'include',
        })
        const data = await response.json()
        if (!response.ok) {
          if (response.status === 401) logout()
          throw new Error(data.message || 'Could not load activity history.')
        }
        if (active) setActivities(data.activity || [])
      } catch (activityError) {
        if (active) setError(activityError.message || 'Could not load activity history.')
      } finally {
        if (active) setLoadingActivity(false)
      }
    }

    loadActivity()
    return () => {
      active = false
    }
  }, [activeCategory, activityRefreshKey, isAuthenticated])

  const categories = useMemo(
    () => [...new Set(prompts.filter((prompt) => !prompt.archived).map((prompt) => prompt.category))].sort(),
    [prompts],
  )

  const activePrompts = useMemo(
    () => prompts.filter((prompt) => !prompt.archived),
    [prompts],
  )
  const archivedCount = prompts.filter((prompt) => prompt.archived).length

  const visiblePrompts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return prompts
      .filter((prompt) => {
        const matchesCategory =
          activeCategory === 'All prompts'
            ? !prompt.archived
            : activeCategory === 'Favorites'
              ? !prompt.archived && prompt.favorite
              : activeCategory === 'Archived'
                ? prompt.archived
                : activeCategory === 'Collection'
                  ? collectionPromptIds.includes(prompt.id) && !prompt.archived
                  : !prompt.archived && prompt.category === activeCategory

        const searchableText = [
          prompt.title,
          prompt.description,
          prompt.content,
          prompt.category,
          ...(prompt.tags || []),
        ]
          .join(' ')
          .toLowerCase()

        return matchesCategory && searchableText.includes(normalizedQuery)
      })
      .sort((first, second) =>
        sortBy === 'title'
          ? first.title.localeCompare(second.title)
          : new Date(second.updatedAt) - new Date(first.updatedAt),
      )
  }, [activeCategory, collectionPromptIds, prompts, query, sortBy])

  function saveUser(nextUser) {
    setIsAuthenticated(true)
    setSessionChecked(true)
    setUser(nextUser)

    try {
      window.localStorage.setItem(userKey, JSON.stringify(nextUser))
    } catch {}
  }

  function logout() {
    setIsAuthenticated(false)
    setSessionChecked(true)
    setUser(null)
    setPrompts([])
    setCollections([])
    setActivities([])
    setSelectedCollection(null)
    setCollectionPromptIds([])
    setAuthMode('login')

    try {
      window.localStorage.removeItem(userKey)
    } catch {}
  }

  async function endSession() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch (logoutError) {
      setError(logoutError.message || 'Could not end the session on the server.')
    } finally {
      logout()
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    setAuthMessage('')

    try {
      if (authMode === 'forgot') {
        const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authForm.email }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Could not request a password reset.')
        setAuthMessage(data.message)
        setResetOtp('')
        setAuthMode('reset')
        return
      }

      if (authMode === 'reset') {
        if (authForm.password !== resetPasswordConfirm) {
          throw new Error('Passwords do not match.')
        }
        const response = await fetch(`${API_URL}/api/auth/reset-password`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: authForm.email,
            otp: resetOtp,
            newPassword: authForm.password,
          }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Could not reset your password.')
        setResetOtp('')
        setAuthForm({ name: '', email: '', password: '' })
        setResetPasswordConfirm('')
        setAuthMode('login')
        setAuthMessage(data.message)
        return
      }

      const endpoint = authMode === 'login' ? 'login' : 'register'
      const payload =
        authMode === 'login'
          ? {
              email: authForm.email,
              password: authForm.password,
            }
          : {
              name: authForm.name,
              email: authForm.email,
              password: authForm.password,
            }

      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed.')
      }

      saveUser(data.user)
      setAuthForm({ name: '', email: '', password: '' })
      setAuthMessage('')
      setNotice(authMode === 'login' ? 'Logged in successfully.' : 'Account created successfully.')
    } catch (authError) {
      setError(authError.message)
    } finally {
      setPending(false)
    }
  }

  async function apiRequest(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase()
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.headers || {}),
      },
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      if (response.status === 401) {
        logout()
        setError('Your session expired or is no longer valid. Log in again.')
      }
      throw new Error(data.message || 'Request failed.')
    }

    if (activeCategory === 'Activity' && method !== 'GET') {
      setActivityRefreshKey((current) => current + 1)
    }
    return data
  }

  async function refreshPrompts() {
    const data = await apiRequest('/api/prompts')
    setPrompts(data.prompts || [])
  }

  async function refreshCollections() {
    const data = await apiRequest('/api/collections')
    setCollections(data.collections || [])
  }

  async function saveProfile(name) {
    const data = await apiRequest('/api/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setUser(data.user)
    try {
      window.localStorage.setItem(userKey, JSON.stringify(data.user))
    } catch {}
    setProfileDialog(false)
    setNotice('Profile updated.')
  }

  async function saveTheme(theme) {
    const data = await apiRequest('/api/auth/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    })
    setUser(data.user)
    try {
      window.localStorage.setItem(userKey, JSON.stringify(data.user))
    } catch {}
    setNotice(`Theme changed to ${theme}.`)
  }

  async function changePassword(currentPassword, newPassword) {
    const data = await apiRequest('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    setNotice(data.message)
    setAuthMessage('Password changed. Please sign in again.')
    logout()
  }

  async function exportData() {
    setTransferringData(true)
    setError('')
    try {
      const response = await fetch(
        `${API_URL}/api/export?format=${encodeURIComponent(transferFormat)}`,
        {
          credentials: 'include',
        },
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 401) logout()
        throw new Error(data.message || 'Could not export your prompts.')
      }
      const file = await response.blob()
      const downloadUrl = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `promptvault-export-${new Date().toISOString().slice(0, 10)}.${transferFormat}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      setNotice(`Prompt data exported as ${transferFormat.toUpperCase()}. Keep exported files private.`)
    } catch (exportError) {
      setError(exportError.message || 'Could not export your prompts.')
    } finally {
      setTransferringData(false)
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['json', 'csv', 'md', 'markdown', 'txt'].includes(extension)) {
      setError('Choose a JSON, CSV, Markdown, or TXT file.')
      return
    }
    if (file.size > 900 * 1024) {
      setError('Import files must be smaller than 900 KB.')
      return
    }

    setTransferringData(true)
    setError('')
    try {
      const data = await apiRequest('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          format: extension,
          content: await file.text(),
        }),
      })
      await Promise.all([refreshPrompts(), refreshCollections()])
      setSelectedCollection(null)
      setCollectionPromptIds([])
      setActiveCategory('All prompts')
      setNotice(data.message)
    } catch (importError) {
      setError(importError.message || 'Could not import this file.')
    } finally {
      setTransferringData(false)
    }
  }

  async function openCollection(collection) {
    try {
      const data = await apiRequest(`/api/collections/${collection.id}/prompts`)
      setSelectedCollection(collection)
      setCollectionPromptIds(data.prompts.map((prompt) => prompt.id))
      setActiveCategory('Collection')
    } catch (collectionError) {
      setError(collectionError.message)
    }
  }

  async function saveCollection(collectionData, collectionId = null) {
    try {
      const data = await apiRequest(
        collectionId ? `/api/collections/${collectionId}` : '/api/collections',
        {
          method: collectionId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectionData),
        },
      )
      setNotice(data.message)
      await refreshCollections()
      if (promptToCollect && !collectionId) {
        await addPromptToCollection(data.collection.id, promptToCollect.id)
      }
      return data.collection
    } catch (collectionError) {
      setError(collectionError.message)
      return null
    }
  }

  async function addPromptToCollection(collectionId, promptId) {
    try {
      await apiRequest(`/api/collections/${collectionId}/prompts/${promptId}`, {
        method: 'POST',
      })
      await refreshCollections()
      if (selectedCollection?.id === collectionId) {
        setCollectionPromptIds((current) => [...new Set([...current, promptId])])
      }
      setNotice('Prompt added to collection.')
    } catch (collectionError) {
      setError(collectionError.message)
    }
  }

  async function removePromptFromCollection(collectionId, promptId) {
    try {
      await apiRequest(`/api/collections/${collectionId}/prompts/${promptId}`, {
        method: 'DELETE',
      })
      await refreshCollections()
      if (selectedCollection?.id === collectionId) {
        setCollectionPromptIds((current) => current.filter((id) => id !== promptId))
      }
      setNotice('Prompt removed from collection.')
    } catch (collectionError) {
      setError(collectionError.message)
    }
  }

  async function deleteCollection(collectionId) {
    if (!window.confirm('Delete this collection? Prompts in it will not be deleted.')) return
    try {
      await apiRequest(`/api/collections/${collectionId}`, { method: 'DELETE' })
      if (selectedCollection?.id === collectionId) {
        setSelectedCollection(null)
        setCollectionPromptIds([])
        setActiveCategory('All prompts')
      }
      await refreshCollections()
      setNotice('Collection deleted. Its prompts are unchanged.')
    } catch (collectionError) {
      setError(collectionError.message)
    }
  }

  async function togglePromptSharing(prompt) {
    const isPublic = !prompt.isPublic
    try {
      const data = await apiRequest(`/api/prompts/${prompt.id}/sharing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic }),
      })
      setPrompts((current) =>
        current.map((item) => item.id === prompt.id ? data.prompt : item),
      )
      if (isPublic && data.prompt.shareId) {
        const shareUrl = `${window.location.origin}/share/prompt/${data.prompt.shareId}`
        try {
          await navigator.clipboard.writeText(shareUrl)
          setNotice('Public link enabled and copied.')
        } catch {
          setNotice(`Public link enabled: ${shareUrl}`)
        }
      } else {
        setNotice('Public sharing disabled.')
      }
    } catch (sharingError) {
      setError(sharingError.message)
    }
  }

  async function toggleCollectionSharing(collection) {
    if (collection.isPublic && collection.shareId) {
      const shareUrl = `${window.location.origin}/share/collection/${collection.shareId}`
      try {
        await navigator.clipboard.writeText(shareUrl)
        setNotice('Public collection link copied.')
      } catch {
        setNotice(`Public collection link: ${shareUrl}`)
      }
      return
    }

    const updated = await saveCollection({ isPublic: true }, collection.id)
    if (updated?.shareId) {
      const shareUrl = `${window.location.origin}/share/collection/${updated.shareId}`
      try {
        await navigator.clipboard.writeText(shareUrl)
        setNotice('Public collection link copied.')
      } catch {
        setNotice(`Public collection link: ${shareUrl}`)
      }
    }
  }

  async function savePrompt(promptData) {
    try {
      if (editingPrompt) {
        await apiRequest(`/api/prompts/${editingPrompt.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(promptData),
        })
        setNotice('Prompt updated successfully.')
      } else {
        await apiRequest('/api/prompts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(promptData),
        })
        setNotice('Prompt saved successfully.')
      }

      setEditingPrompt(null)
      setIsCreating(false)
      await refreshPrompts()
      return true
    } catch (saveError) {
      setError(saveError.message)
      return false
    }
  }

  async function openVersionHistory(prompt) {
    setHistoryPrompt(prompt)
    setLoadingVersions(true)
    setVersions([])
    try {
      const data = await apiRequest(`/api/prompts/${prompt.id}/versions`)
      setVersions(data.versions || [])
    } catch (historyError) {
      setError(historyError.message)
      setHistoryPrompt(null)
    } finally {
      setLoadingVersions(false)
    }
  }

  async function restoreVersion(version) {
    if (!historyPrompt) return
    if (!window.confirm(`Restore version ${version.version}? This will create a new version and keep the history.`)) return

    try {
      const data = await apiRequest(
        `/api/prompts/${historyPrompt.id}/versions/${version.version}/restore`,
        { method: 'POST' },
      )
      setNotice(data.message)
      setHistoryPrompt(null)
      await refreshPrompts()
    } catch (restoreError) {
      setError(restoreError.message)
    }
  }

  async function openPromptTester(prompt) {
    const variableNames = promptVariables(prompt.content)
    setError('')
    setTesterPrompt(prompt)
    setTestVariables(Object.fromEntries(variableNames.map((name) => [name, ''])))
    setTestResult(null)
    setSavedTestRuns([])
    setCompareRunId('')

    try {
      const data = await apiRequest(`/api/prompts/${prompt.id}/test-results`)
      setSavedTestRuns(data.testRuns || [])
    } catch (testHistoryError) {
      setError(testHistoryError.message)
    }
  }

  async function runPromptTest() {
    if (!testerPrompt) return
    setRunningTest(true)
    setError('')
    setTestResult(null)
    try {
      const result = await apiRequest(`/api/prompts/${testerPrompt.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: testVariables }),
      })
      setTestResult(result)
    } catch (testError) {
      setError(testError.message)
    } finally {
      setRunningTest(false)
    }
  }

  async function savePromptTest() {
    if (!testerPrompt || !testResult) return
    setSavingTest(true)
    setError('')
    try {
      const data = await apiRequest(`/api/prompts/${testerPrompt.id}/test-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: testVariables }),
      })
      setSavedTestRuns((current) => [data.testRun, ...current])
      setCompareRunId(String(data.testRun._id || data.testRun.id || ''))
      setNotice('Test result saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingTest(false)
    }
  }

  async function updateFavorite(id, favoriteValue) {
    try {
      const prompt = prompts.find((item) => item.id === id)
      if (!prompt) return

      const updated = await apiRequest(`/api/prompts/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...prompt, favorite: favoriteValue }),
      })

      setPrompts((current) =>
        current.map((item) => (item.id === id ? updated.prompt : item)),
      )
    } catch (favoriteError) {
      setError(favoriteError.message)
    }
  }

  async function duplicatePrompt(prompt) {
    try {
      await apiRequest(`/api/prompts/${prompt.id}/duplicate`, {
        method: 'POST',
      })
      setNotice('Prompt duplicated.')
      await refreshPrompts()
    } catch (duplicateError) {
      setError(duplicateError.message)
    }
  }

  async function toggleArchived(prompt) {
    const action = prompt.archived ? 'restore' : 'archive'
    try {
      const data = await apiRequest(`/api/prompts/${prompt.id}/${action}`, {
        method: 'POST',
      })
      setNotice(data.message)
      await refreshPrompts()
    } catch (archiveError) {
      setError(archiveError.message)
    }
  }

  async function deletePrompt(id) {
    const confirmed = window.confirm('Delete this prompt?')
    if (!confirmed) return

    try {
      await apiRequest(`/api/prompts/${id}`, {
        method: 'DELETE',
      })
      setNotice('Prompt deleted.')
      await refreshPrompts()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  async function copyPrompt(prompt) {
    try {
      await navigator.clipboard.writeText(prompt.content)
      try {
        await apiRequest(`/api/prompts/${prompt.id}/copy`, { method: 'POST' })
      } catch (trackingError) {
        setError(`Prompt copied, but usage could not be recorded: ${trackingError.message}`)
        return
      }
      setNotice('Copied to clipboard.')
    } catch {
      setError('Clipboard access failed. Please copy manually.')
    }
  }

  const favoriteCount = activePrompts.filter((prompt) => prompt.favorite).length
  const latestUpdated = activePrompts.length
    ? activePrompts.reduce(
        (latest, prompt) =>
          new Date(prompt.updatedAt) > new Date(latest) ? prompt.updatedAt : latest,
        activePrompts[0].updatedAt,
      )
    : null

  if (sharedRoute) {
    return <SharedPage type={sharedRoute[1]} shareId={sharedRoute[2]} />
  }

  if (featuredRoute) return <FeaturedPromptsPage />

  if (!sessionChecked) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="auth-subtitle" role="status">Checking your session...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    const authHeading =
      authMode === 'register'
        ? 'Create your account'
        : authMode === 'forgot'
          ? 'Reset your password'
          : authMode === 'reset'
            ? 'Choose a new password'
            : 'Welcome back'
    const authSubtitle =
      authMode === 'register'
        ? 'Start saving high-quality prompts in one clean workspace.'
        : authMode === 'forgot'
            ? 'We’ll email a one-time reset code if an account matches.'
          : authMode === 'reset'
              ? 'Enter the six-digit code from your email and choose a new password.'
            : 'Log in to organize and reuse your best prompts.'

    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand auth-brand">
            <span className="brand-mark" aria-hidden="true">P</span>
            <span>prompt<span className="brand-light">vault</span></span>
          </div>

          <div className="auth-header">
            <p className="eyebrow">A SMART PROMPT LIBRARY</p>
            <h1>{authHeading}</h1>
            <p className="auth-subtitle">{authSubtitle}</p>
          </div>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            {authMode === 'register' && (
              <label className="form-field">
                <span>Name</span>
                <input
                  type="text"
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Your full name"
                  required
                />
              </label>
            )}

            {authMode !== 'reset' && (
              <label className="form-field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={authForm.email}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="you@example.com"
                  required
                />
              </label>
            )}

            {authMode === 'reset' && (
              <>
                <label className="form-field">
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={authForm.email}
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="you@example.com"
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Six-digit reset code</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={resetOtp}
                    onChange={(event) => setResetOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter the code from your email"
                    required
                  />
                </label>
              </>
            )}

            {authMode !== 'forgot' && (
              <label className="form-field">
                <span>{authMode === 'reset' ? 'New password' : 'Password'}</span>
                <input
                  type="password"
                  autoComplete={authMode === 'reset' ? 'new-password' : authMode === 'login' ? 'current-password' : 'new-password'}
                  value={authForm.password}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder={authMode === 'login' ? 'Enter your password' : 'At least 12 characters'}
                  required
                  minLength={authMode === 'login' ? undefined : 12}
                />
              </label>
            )}

            {authMode === 'reset' && (
              <label className="form-field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={resetPasswordConfirm}
                  onChange={(event) => setResetPasswordConfirm(event.target.value)}
                  required
                  minLength={12}
                />
              </label>
            )}

            {authMessage && <div className="auth-message" role="status">{authMessage}</div>}
            {error && <div className="inline-error">{error}</div>}

            <button className="primary-button auth-submit" type="submit" disabled={pending}>
              {pending
                ? 'Please wait...'
                : authMode === 'login'
                  ? 'Log in'
                  : authMode === 'register'
                    ? 'Create account'
                    : authMode === 'forgot'
                      ? 'Send reset code'
                      : 'Reset password'}
            </button>
          </form>

          {authMode === 'login' && (
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setAuthMode('forgot')
                setError('')
                setAuthMessage('')
              }}
            >
              Forgot password?
            </button>
          )}
          {authMode !== 'reset' && (
            <button
              type="button"
              className="secondary-button auth-toggle"
              onClick={() => {
                setAuthMode((current) => current === 'register' ? 'login' : 'register')
                setError('')
                setAuthMessage('')
              }}
            >
              {authMode === 'register' ? 'Already have an account? Log in' : 'Need an account? Sign up'}
            </button>
          )}
          {(authMode === 'forgot' || authMode === 'reset') && (
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                if (authMode === 'reset') {
                  setResetOtp('')
                  setResetPasswordConfirm('')
                }
                setAuthMode('login')
                setError('')
                setAuthMessage('')
              }}
            >
              Back to log in
            </button>
          )}
          {authMode === 'reset' && (
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setAuthForm((current) => ({ ...current, password: '' }))
                setResetPasswordConfirm('')
                setResetOtp('')
                setAuthMode('forgot')
                setError('')
                setAuthMessage('')
              }}
            >
              Send another code
            </button>
          )}
          {(authMode === 'login' || authMode === 'register') && (
            <a className="auth-link" href="/discover">Explore featured prompts</a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell" data-theme={user?.theme === 'dark' ? 'dark' : 'light'}>
      <aside className="sidebar">
        <div className="brand" aria-label="PromptVault home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>prompt<span className="brand-light">vault</span></span>
        </div>

        <div className="sidebar-label">LIBRARY</div>
        <nav className="library-nav" aria-label="Prompt library">
          <button
            className={`nav-item ${activeCategory === 'All prompts' ? 'active' : ''}`}
            onClick={() => setActiveCategory('All prompts')}
          >
            <span className="nav-icon" aria-hidden="true">▤</span>
            <span>All prompts</span>
            <span className="nav-count">{prompts.length}</span>
          </button>
          <button
            className={`nav-item ${activeCategory === 'Favorites' ? 'active' : ''}`}
            onClick={() => setActiveCategory('Favorites')}
          >
            <span className="nav-icon favorite-icon" aria-hidden="true">★</span>
            <span>Favorites</span>
            <span className="nav-count">{favoriteCount}</span>
          </button>
          <button
            className={`nav-item ${activeCategory === 'Archived' ? 'active' : ''}`}
            onClick={() => setActiveCategory('Archived')}
          >
            <span className="nav-icon" aria-hidden="true">▱</span>
            <span>Archived</span>
            <span className="nav-count">{archivedCount}</span>
          </button>
          <button
            className={`nav-item ${activeCategory === 'Activity' ? 'active' : ''}`}
            onClick={() => setActiveCategory('Activity')}
          >
            <span className="nav-icon" aria-hidden="true">◷</span>
            <span>Activity</span>
          </button>
          <a className="nav-item featured-nav-link" href="/discover">
            <span className="nav-icon" aria-hidden="true">✦</span>
            <span>Featured prompts</span>
            <span className="nav-external" aria-hidden="true">↗</span>
          </a>
        </nav>

        <div className="category-heading">
          <span className="sidebar-label">CATEGORIES</span>
          <span className="category-total">{categories.length}</span>
        </div>
        <nav className="category-nav" aria-label="Categories">
          {categories.map((category, index) => (
            <button
              className={`nav-item category-item ${activeCategory === category ? 'active' : ''}`}
              key={category}
              onClick={() => setActiveCategory(category)}
            >
              <span className={`category-dot dot-${index % 4}`} aria-hidden="true" />
              <span>{category}</span>
              <span className="nav-count">
                {activePrompts.filter((prompt) => prompt.category === category).length}
              </span>
            </button>
          ))}
        </nav>

        <div className="category-heading collection-heading">
          <span className="sidebar-label">COLLECTIONS</span>
          <button
            className="collection-add"
            onClick={() => {
              setPromptToCollect(null)
              setCollectionDialog(true)
            }}
            aria-label="Manage collections"
            title="Manage collections"
          >
            +
          </button>
        </div>
        <nav className="category-nav collection-nav" aria-label="Collections">
          {collections.map((collection, index) => (
            <button
              className={`nav-item category-item ${activeCategory === 'Collection' && selectedCollection?.id === collection.id ? 'active' : ''}`}
              key={collection.id}
              onClick={() => openCollection(collection)}
            >
              <span className={`category-dot dot-${index % 4}`} aria-hidden="true" />
              <span className="collection-nav-name">{collection.name}</span>
              {collection.isPublic && <span className="public-indicator" title="Public collection">↗</span>}
              <span className="nav-count">{collection.promptCount ?? 0}</span>
            </button>
          ))}
          {collections.length === 0 && (
            <button
              className="collection-empty-action"
              onClick={() => {
                setPromptToCollect(null)
                setCollectionDialog(true)
              }}
            >
              + Create a collection
            </button>
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-card">
            <span className="storage-icon" aria-hidden="true">◇</span>
            <div>
              <strong>{user ? user.name : 'PromptVault'}</strong>
              <p>{user ? user.email : 'Logged in securely'}</p>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">{(user?.name || 'U').charAt(0).toUpperCase()}</span>
            <button
              className="profile-name"
              type="button"
              onClick={() => setProfileDialog(true)}
              aria-label="Edit profile"
            >
              {user ? user.name : 'Workspace'}
            </button>
            <button className="logout-button" onClick={endSession} type="button">Logout</button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> {activeCategory}</div>
          <div className="topbar-actions">
            <div className="transfer-actions">
              <select
                className="transfer-format"
                aria-label="Export format"
                value={transferFormat}
                onChange={(event) => setTransferFormat(event.target.value)}
                disabled={transferringData}
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="md">Markdown</option>
                <option value="txt">TXT</option>
              </select>
              <button
                className="secondary-button backup-button"
                type="button"
                onClick={exportData}
                disabled={transferringData}
              >
                <span aria-hidden="true">⇩</span> Export
              </button>
              <button
                className="secondary-button import-button"
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={transferringData}
              >
                <span aria-hidden="true">⇧</span> Import
              </button>
              <input
                ref={importInputRef}
                className="visually-hidden"
                type="file"
                accept=".json,.csv,.md,.markdown,.txt,application/json,text/csv,text/markdown,text/plain"
                onChange={importFile}
              />
            </div>
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search prompts"
                placeholder="Search prompts..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
          </div>
        </header>

        <section className="content-area">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">YOUR PERSONAL PROMPT LIBRARY</p>
              <h1>{activeCategory === 'All prompts' ? 'Good ideas, kept close.' : activeCategory === 'Archived' ? 'Out of sight, still safe.' : activeCategory === 'Collection' ? selectedCollection?.name || 'Collection' : activeCategory === 'Activity' ? 'Activity history' : activeCategory}</h1>
              <p className="welcome-copy">
                {activeCategory === 'Activity'
                  ? 'Review recent changes to your prompts and collections.'
                  : 'Keep your prompting workflow organized, searchable, and ready whenever inspiration strikes.'}
              </p>
            </div>
            {activeCategory !== 'Activity' && (
              <button className="primary-button" onClick={() => setIsCreating(true)}>
                <span aria-hidden="true">＋</span> New prompt
              </button>
            )}
          </div>

          {error && <div className="storage-warning">{error}</div>}

          {activeCategory === 'Activity' ? (
            <section className="activity-panel" aria-label="Recent activity">
              {loadingActivity ? (
                <div className="loading-state">Loading activity...</div>
              ) : activities.length ? (
                <ol className="activity-list">
                  {activities.map((item) => (
                    <li className="activity-item" key={item.id}>
                      <span className="activity-marker" aria-hidden="true">•</span>
                      <div className="activity-description">
                        <strong>{activityLabels[item.action] || 'Updated PromptVault'}</strong>
                        <span>{item.entityTitle}</span>
                        {item.details && <small>{item.details}</small>}
                      </div>
                      <time dateTime={item.createdAt}>{formatActivityDate(item.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true">◷</span>
                  <h3>No activity yet</h3>
                  <p>Actions you take on prompts and collections will appear here.</p>
                </div>
              )}
            </section>
          ) : (
            <>
          <div className="stats-row">
            <div className="stat-card">
              <span className="stat-icon purple" aria-hidden="true">▤</span>
              <span className="stat-copy"><strong>{activePrompts.length}</strong><span>Total prompts</span></span>
            </div>
            <div className="stat-card">
              <span className="stat-icon yellow" aria-hidden="true">★</span>
              <span className="stat-copy"><strong>{favoriteCount}</strong><span>Favorites</span></span>
            </div>
            <div className="stat-card">
              <span className="stat-icon green" aria-hidden="true">◷</span>
              <span className="stat-copy">
                <strong>{latestUpdated ? formatDate(latestUpdated) : '—'}</strong>
                <span>Last updated</span>
              </span>
            </div>
          </div>

          <div className="prompt-section-heading">
            <div>
              <h2>{activeCategory === 'All prompts' ? 'Your prompts' : activeCategory === 'Archived' ? 'Archived prompts' : activeCategory}</h2>
              <span>{visiblePrompts.length} {visiblePrompts.length === 1 ? 'prompt' : 'prompts'}</span>
            </div>
            <label className="sort-label">
              <span>Sort by</span>
              <select aria-label="Sort prompts" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="recent">Recently updated</option>
                <option value="title">Title A to Z</option>
              </select>
            </label>
          </div>

          {loadingPrompts ? (
            <div className="loading-state">Loading prompts...</div>
          ) : visiblePrompts.length > 0 ? (
            <div className="prompt-grid">
              {visiblePrompts.map((prompt) => (
                <article className="prompt-card" key={prompt.id}>
                  <div className="card-topline">
                    <span className={`prompt-category ${prompt.category.toLowerCase().replace(/\s+/g, '-')}`}>
                      <span className={`category-dot dot-${categories.indexOf(prompt.category) % 4}`} aria-hidden="true" />
                      {prompt.category}
                    </span>
                    <button
                      className={`icon-button star-button ${prompt.favorite ? 'is-favorite' : ''}`}
                      aria-label={prompt.favorite ? 'Remove from favorites' : 'Add to favorites'}
                      onClick={() => updateFavorite(prompt.id, !prompt.favorite)}
                    >
                      {prompt.favorite ? '★' : '☆'}
                    </button>
                  </div>
                  <h3>{prompt.title}</h3>
                  <p className="prompt-description">{prompt.description || 'A saved prompt, ready when you need it.'}</p>
                  <div className="prompt-preview">{prompt.content}</div>
                  <div className="tag-row">
                    {(prompt.tags || []).map((tag) => (
                      <span className="tag" key={`${prompt.id}-${tag}`}>#{tag}</span>
                    ))}
                  </div>
                  <div className="card-footer">
                    <span className="updated-date">Updated {formatDate(prompt.updatedAt)}</span>
                    <div className="card-actions">
                      <button className="text-action" onClick={() => copyPrompt(prompt)}>
                        <span aria-hidden="true">▢</span> Copy
                      </button>
                      <button
                        className="text-action history-action"
                        onClick={() => {
                          setPromptToCollect(prompt)
                          setCollectionDialog(true)
                        }}
                        aria-label={`Add ${prompt.title} to a collection`}
                      >
                        <span aria-hidden="true">▤</span> Collect
                      </button>
                      {activeCategory === 'Collection' && selectedCollection && (
                        <button
                          className="text-action history-action"
                          onClick={() => removePromptFromCollection(selectedCollection.id, prompt.id)}
                          aria-label={`Remove ${prompt.title} from ${selectedCollection.name}`}
                        >
                          <span aria-hidden="true">−</span> Remove from collection
                        </button>
                      )}
                      <button
                        className="text-action history-action"
                        onClick={() => togglePromptSharing(prompt)}
                        aria-label={prompt.isPublic ? `Disable sharing for ${prompt.title}` : `Share ${prompt.title}`}
                        title={prompt.isPublic ? 'Disable public sharing' : 'Create a read-only public link'}
                      >
                        <span aria-hidden="true">{prompt.isPublic ? '↗' : '⌁'}</span>
                        {prompt.isPublic ? 'Shared' : 'Share'}
                      </button>
                      <button
                        className="text-action history-action"
                        onClick={() => openPromptTester(prompt)}
                        aria-label={`Test ${prompt.title}`}
                      >
                        <span aria-hidden="true">▷</span> Test
                      </button>
                      {!prompt.archived && (
                        <button
                          className="text-action history-action"
                          onClick={() => duplicatePrompt(prompt)}
                          aria-label={`Duplicate ${prompt.title}`}
                        >
                          <span aria-hidden="true">▣</span> Duplicate
                        </button>
                      )}
                      <button
                        className="text-action history-action"
                        onClick={() => toggleArchived(prompt)}
                        aria-label={prompt.archived ? `Restore ${prompt.title}` : `Archive ${prompt.title}`}
                      >
                        <span aria-hidden="true">{prompt.archived ? '↥' : '▱'}</span>
                        {prompt.archived ? 'Restore' : 'Archive'}
                      </button>
                      <button
                        className="text-action history-action"
                        onClick={() => openVersionHistory(prompt)}
                        aria-label={`Version history for ${prompt.title}`}
                      >
                        <span aria-hidden="true">◷</span> History
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${prompt.title}`}
                        onClick={() => setEditingPrompt(prompt)}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-button delete-action"
                        aria-label={`Delete ${prompt.title}`}
                        onClick={() => deletePrompt(prompt.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">⌕</span>
              <h3>{query ? 'No prompts found' : activeCategory === 'Archived' ? 'No archived prompts' : 'Nothing in this collection yet'}</h3>
              <p>{query ? 'Try another search or clear the search box.' : activeCategory === 'Archived' ? 'Archived prompts will stay here until you restore or delete them.' : 'Create your first prompt to get started.'}</p>
              {activeCategory !== 'Archived' && (
                <button className="primary-button" onClick={() => setIsCreating(true)}>
                  <span aria-hidden="true">＋</span> Create your first prompt
                </button>
              )}
            </div>
          )}
            </>
          )}
        </section>
      </main>

      {notice && (
        <div className="toast" role="status">
          <span aria-hidden="true">✓</span> {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      {(isCreating || editingPrompt) && (
        <PromptDialog
          prompt={editingPrompt}
          categories={categories}
          saveError={error}
          onClose={() => {
            setEditingPrompt(null)
            setIsCreating(false)
          }}
          onSave={async (payload) => {
            const succeeded = await savePrompt(payload)
            if (succeeded) setError('')
          }}
        />
      )}

      {historyPrompt && (
        <VersionHistoryDialog
          prompt={historyPrompt}
          versions={versions}
          loading={loadingVersions}
          onClose={() => setHistoryPrompt(null)}
          onRestore={restoreVersion}
        />
      )}

      {testerPrompt && (
        <PromptTesterDialog
          prompt={testerPrompt}
          variables={testVariables}
          onVariablesChange={setTestVariables}
          result={testResult}
          savedRuns={savedTestRuns}
          compareRunId={compareRunId}
          onCompareChange={setCompareRunId}
          running={runningTest}
          saving={savingTest}
          error={error}
          onClearError={() => setError('')}
          onClose={() => {
            setTesterPrompt(null)
            setTestResult(null)
          }}
          onRun={runPromptTest}
          onSave={savePromptTest}
        />
      )}

      {collectionDialog && (
        <CollectionManagerDialog
          collections={collections}
          prompts={activePrompts}
          prompt={promptToCollect}
          selectedCollectionId={selectedCollection?.id || ''}
          collectionPromptIds={collectionPromptIds}
          onClose={() => {
            setCollectionDialog(false)
            setPromptToCollect(null)
          }}
          onSave={saveCollection}
          onDelete={deleteCollection}
          onToggleSharing={toggleCollectionSharing}
          onAddPrompt={addPromptToCollection}
          onRemovePrompt={removePromptFromCollection}
          onOpenCollection={openCollection}
        />
      )}

      {profileDialog && (
        <ProfileDialog
          user={user}
          onClose={() => setProfileDialog(false)}
          onSave={saveProfile}
          onSaveTheme={saveTheme}
          onChangePassword={changePassword}
        />
      )}
    </div>
  )
}

function ProfileDialog({ user, onClose, onSave, onSaveTheme, onChangePassword }) {
  const [name, setName] = useState(user?.name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [passwordForm, setPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingTheme, setSavingTheme] = useState(false)

  async function submitProfile(event) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave(trimmedName)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function submitPassword(event) {
    event.preventDefault()
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onChangePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordForm(false)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  function togglePasswordForm() {
    setPasswordForm((visible) => !visible)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
  }

  async function changeTheme(theme) {
    setSavingTheme(true)
    setError('')
    try {
      await onSaveTheme(theme)
    } catch (saveError) {
      setError(saveError.message || 'Could not update the theme.')
    } finally {
      setSavingTheme(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="prompt-dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">ACCOUNT SETTINGS</p>
            <h2 id="profile-dialog-title">Your profile</h2>
          </div>
          <button className="icon-button dialog-close" aria-label="Close profile" onClick={onClose}>×</button>
        </div>
        <form className="profile-form" onSubmit={submitProfile}>
          <label className="form-field">
            <span>Name</span>
            <input
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="form-field">
            <span>Email</span>
            <input value={user?.email || ''} readOnly />
            <small>Email address cannot be changed here.</small>
          </label>
          <label className="form-field">
            <span>Appearance</span>
            <select
              value={user?.theme === 'dark' ? 'dark' : 'light'}
              onChange={(event) => changeTheme(event.target.value)}
              disabled={savingTheme}
            >
              <option value="light">Light theme</option>
              <option value="dark">Dark theme</option>
            </select>
            <small>{savingTheme ? 'Saving preference...' : 'Saved to your account and used on your next sign-in.'}</small>
          </label>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Close</button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </form>
        <button
          className="secondary-button password-toggle"
          type="button"
          onClick={togglePasswordForm}
        >
          {passwordForm ? 'Cancel password change' : 'Change password'}
        </button>
        {passwordForm && (
          <form className="profile-form password-form" onSubmit={submitPassword}>
            <label className="form-field">
              <span>Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label className="form-field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <label className="form-field">
              <span>Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Update password'}
            </button>
          </form>
        )}
        {error && <div className="inline-error" role="alert">{error}</div>}
      </section>
    </div>
  )
}

function PromptDialog({ prompt, categories, saveError, onClose, onSave }) {
  const [title, setTitle] = useState(prompt?.title ?? '')
  const [description, setDescription] = useState(prompt?.description ?? '')
  const [content, setContent] = useState(prompt?.content ?? '')
  const [category, setCategory] = useState(prompt?.category ?? categories[0] ?? 'Coding')
  const [tags, setTags] = useState((prompt?.tags || []).join(', '))
  const [changeNotes, setChangeNotes] = useState('')
  const [localError, setLocalError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()

    if (!title.trim() || !content.trim() || !category.trim()) {
      setLocalError('Title, content, and category are required.')
      return
    }

    await onSave({
      title: title.trim(),
      description: description.trim(),
      content: content.trim(),
      category: category.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      favorite: prompt?.favorite ?? false,
      changeNotes: changeNotes.trim(),
    })
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{prompt ? 'MAKE IT EVEN BETTER' : 'ADD TO YOUR LIBRARY'}</p>
            <h2 id="dialog-title">{prompt ? 'Edit prompt' : 'Create a prompt'}</h2>
          </div>
          <button className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Title</span>
            <input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="form-field">
            <span>Short description</span>
            <input maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>

          <label className="form-field">
            <span>Prompt</span>
            <textarea required maxLength={50000} rows={6} value={content} onChange={(event) => setContent(event.target.value)} />
          </label>

          {prompt && (
            <label className="form-field">
              <span>Change notes <small>Optional, saved in version history</small></span>
              <input
                maxLength={300}
                value={changeNotes}
                onChange={(event) => setChangeNotes(event.target.value)}
                placeholder="What changed in this version?"
              />
            </label>
          )}

          <div className="form-row">
            <label className="form-field">
              <span>Category</span>
              <input list="prompt-categories" maxLength={80} value={category} onChange={(event) => setCategory(event.target.value)} />
              <datalist id="prompt-categories">
                {categories.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>

            <label className="form-field">
              <span>Tags</span>
              <input maxLength={819} value={tags} onChange={(event) => setTags(event.target.value)} />
            </label>
          </div>

          {(localError || saveError) && (
            <div className="inline-error">{localError || saveError}</div>
          )}

          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit">{prompt ? 'Save changes' : 'Save prompt'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function VersionHistoryDialog({ prompt, versions, loading, onClose, onRestore }) {
  const [leftVersion, setLeftVersion] = useState('')
  const [rightVersion, setRightVersion] = useState('')
  const [showComparison, setShowComparison] = useState(false)
  const sortedVersions = [...versions].sort((first, second) => second.version - first.version)
  const currentVersion = sortedVersions[0]
  const leftSelection = leftVersion || String(currentVersion?.version ?? '')
  const rightSelection = rightVersion || String((sortedVersions[1] || currentVersion)?.version ?? '')
  const comparisonLeft =
    sortedVersions.find((version) => String(version.version) === leftSelection) || currentVersion
  const comparisonRight =
    sortedVersions.find((version) => String(version.version) === rightSelection) ||
    sortedVersions[1] ||
    currentVersion

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">PROMPT HISTORY</p>
            <h2 id="history-title">{prompt.title}</h2>
          </div>
          <button className="icon-button dialog-close" aria-label="Close history" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="loading-state">Loading versions...</div>
        ) : sortedVersions.length ? (
          <>
            <div className="history-toolbar">
              <span>{sortedVersions.length} saved {sortedVersions.length === 1 ? 'version' : 'versions'}</span>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowComparison((current) => !current)}
                disabled={sortedVersions.length < 2}
              >
                {showComparison ? 'Hide comparison' : 'Compare versions'}
              </button>
            </div>

            {showComparison && (
              <div className="version-comparison">
                {[comparisonLeft, comparisonRight].map((version, index) => (
                  <div className="comparison-pane" key={`${index}-${version?.version}`}>
                    <label className="form-field">
                      <span>{index === 0 ? 'First version' : 'Second version'}</span>
                      <select
                        value={index === 0 ? leftSelection : rightSelection}
                        onChange={(event) =>
                          index === 0
                            ? setLeftVersion(event.target.value)
                            : setRightVersion(event.target.value)
                        }
                      >
                        {sortedVersions.map((option) => (
                          <option key={option.version} value={option.version}>
                            Version {option.version}
                          </option>
                        ))}
                      </select>
                    </label>
                    <pre>{version?.content || ''}</pre>
                  </div>
                ))}
              </div>
            )}

            <div className="version-list">
              {sortedVersions.map((version, index) => (
                <article className="version-entry" key={version.version}>
                  <div className="version-marker">{version.version}</div>
                  <div className="version-details">
                    <div className="version-title-row">
                      <strong>Version {version.version}</strong>
                      {index === 0 && <span className="current-version-badge">Current</span>}
                    </div>
                    <p>{version.changeNotes || 'No change notes provided.'}</p>
                    <time>{new Intl.DateTimeFormat('en', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(version.createdAt))}</time>
                    <pre>{version.content}</pre>
                  </div>
                  {index > 0 && (
                    <button
                      className="secondary-button restore-button"
                      type="button"
                      onClick={() => onRestore(version)}
                    >
                      Restore
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state compact-empty">
            <h3>No versions yet</h3>
            <p>Save an edit to start building version history.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function PromptTesterDialog({
  prompt,
  variables,
  onVariablesChange,
  result,
  savedRuns,
  compareRunId,
  onCompareChange,
  running,
  saving,
  error,
  onClearError,
  onClose,
  onRun,
  onSave,
}) {
  const variableNames = promptVariables(prompt.content)
  const comparedRun = savedRuns.find(
    (run) => String(run._id || run.id) === compareRunId,
  )

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="tester-dialog" role="dialog" aria-modal="true" aria-labelledby="tester-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">PROMPT TESTER · MOCK PROVIDER</p>
            <h2 id="tester-title">{prompt.title}</h2>
          </div>
          <button className="icon-button dialog-close" aria-label="Close tester" onClick={onClose}>×</button>
        </div>

        <div className="tester-prompt-source">
          <span>Prompt template</span>
          <pre>{prompt.content}</pre>
        </div>

        {variableNames.length ? (
          <div className="tester-variables">
            <h3>Fill in variables</h3>
            <div className="tester-variable-grid">
              {variableNames.map((name) => (
                <label className="form-field" key={name}>
                  <span>{`{{${name}}}`}</span>
                  <input
                    value={variables[name] || ''}
                    onChange={(event) =>
                      onVariablesChange((current) => ({
                        ...current,
                        [name]: event.target.value,
                      }))
                    }
                    placeholder={`Enter ${name}`}
                  />
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="tester-no-variables">This prompt has no variables. Run it as written.</p>
        )}

        {error && (
          <div className="inline-error tester-error" role="alert">
            {error}
            <button type="button" aria-label="Dismiss error" onClick={onClearError}>×</button>
          </div>
        )}

        <div className="tester-actions">
          <span className="provider-note">Mock mode previews the rendered prompt; no AI service is called.</span>
          <button className="primary-button" type="button" onClick={onRun} disabled={running}>
            {running ? 'Running...' : 'Run prompt'}
          </button>
        </div>

        {result && (
          <section className="tester-output" aria-live="polite">
            <div className="tester-output-heading">
              <h3>Test output</h3>
              <button className="secondary-button" type="button" onClick={onSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save result'}
              </button>
            </div>
            <pre>{result.output}</pre>
          </section>
        )}

        {savedRuns.length > 0 && (
          <section className="saved-tests">
            <label className="form-field">
              <span>Compare with a saved result</span>
              <select value={compareRunId} onChange={(event) => onCompareChange(event.target.value)}>
                <option value="">Choose saved test</option>
                {savedRuns.map((run, index) => (
                  <option key={run._id || run.id || index} value={run._id || run.id}>
                    Test from {new Intl.DateTimeFormat('en', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(run.createdAt))}
                  </option>
                ))}
              </select>
            </label>
            {result && comparedRun && (
              <div className="version-comparison test-comparison">
                <div className="comparison-pane">
                  <strong>Current test</strong>
                  <pre>{result.output}</pre>
                </div>
                <div className="comparison-pane">
                  <strong>Saved test</strong>
                  <pre>{comparedRun.output}</pre>
                </div>
              </div>
            )}
          </section>
        )}

        <div className="tester-footer">
          <button className="secondary-button" type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  )
}

function CollectionManagerDialog({
  collections,
  prompts,
  prompt,
  selectedCollectionId,
  collectionPromptIds,
  onClose,
  onSave,
  onDelete,
  onToggleSharing,
  onAddPrompt,
  onRemovePrompt,
  onOpenCollection,
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [error, setError] = useState('')

  const editingCollection = collections.find((collection) => collection.id === editingId)
  const focusedCollection =
    collections.find((collection) => collection.id === selectedCollectionId) || null
  const activeCollection = editingCollection || focusedCollection

  async function submitCollection(event) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Collection name is required.')
      return
    }
    const saved = await onSave(
      { name: name.trim(), description: description.trim(), isPublic },
      editingId || null,
    )
    if (saved) {
      setName('')
      setDescription('')
      setIsPublic(false)
      setEditingId('')
      setError('')
    }
  }

  function startEdit(collection) {
    setEditingId(collection.id)
    setName(collection.name)
    setDescription(collection.description || '')
    setIsPublic(Boolean(collection.isPublic))
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="collection-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{prompt ? 'ORGANIZE PROMPT' : 'YOUR LIBRARY'}</p>
            <h2 id="collection-dialog-title">{prompt ? 'Add to collection' : 'Manage collections'}</h2>
          </div>
          <button className="icon-button dialog-close" aria-label="Close collections" onClick={onClose}>×</button>
        </div>

        <form className="collection-form" onSubmit={submitCollection}>
          <h3>{editingCollection ? 'Edit collection' : 'Create a collection'}</h3>
          <div className="form-row">
            <label className="form-field">
              <span>Collection name</span>
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Writing toolkit"
                required
              />
            </label>
            <label className="form-field">
              <span>Description <small>Optional</small></span>
              <input
                value={description}
                maxLength={240}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What belongs here?"
              />
            </label>
          </div>
          <label className="public-toggle">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            <span>
              <strong>Public collection</strong>
              <small>Anyone with its link can view public prompts in this collection.</small>
            </span>
          </label>
          {error && <div className="inline-error">{error}</div>}
          <div className="collection-form-actions">
            {editingCollection && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setEditingId('')
                  setName('')
                  setDescription('')
                  setIsPublic(false)
                }}
              >
                Cancel edit
              </button>
            )}
            <button className="primary-button" type="submit">
              {editingCollection ? 'Save changes' : 'Create collection'}
            </button>
          </div>
        </form>

        <div className="collection-list">
          <h3>Your collections <span>{collections.length}</span></h3>
          {collections.length === 0 ? (
            <p className="collection-empty-message">Create your first collection to group related prompts.</p>
          ) : (
            collections.map((collection) => (
              <article className="collection-row" key={collection.id}>
                <button
                  className={`collection-row-main ${focusedCollection?.id === collection.id ? 'selected' : ''}`}
                  type="button"
                  onClick={() => onOpenCollection(collection)}
                >
                  <span className="collection-row-icon">▤</span>
                  <span>
                    <strong>{collection.name}</strong>
                    <small>{collection.promptCount ?? 0} prompts{collection.isPublic ? ' · Public' : ' · Private'}</small>
                  </span>
                </button>
                <div className="collection-row-actions">
                  {prompt ? (
                    (collection.promptIds || []).includes(prompt.id) ? (
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => onRemovePrompt(collection.id, prompt.id)}
                      >
                        Remove prompt
                      </button>
                    ) : (
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => onAddPrompt(collection.id, prompt.id)}
                      >
                        Add prompt
                      </button>
                    )
                  ) : (
                    <>
                      <button className="icon-button" type="button" aria-label={`Edit ${collection.name}`} onClick={() => startEdit(collection)}>✎</button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={collection.isPublic ? 'Disable collection sharing' : 'Share collection'}
                        title={collection.isPublic ? 'Copy public link' : 'Enable sharing and copy link'}
                        onClick={() => onToggleSharing(collection)}
                      >
                        {collection.isPublic ? '↗' : '⌁'}
                      </button>
                      <button className="icon-button delete-action" type="button" aria-label={`Delete ${collection.name}`} onClick={() => onDelete(collection.id)}>×</button>
                    </>
                  )}
                </div>
              </article>
            ))
          )}
        </div>

        {prompt && activeCollection && (
          <div className="collection-members">
            <div className="collection-list-heading">
              <h3>Prompts in {activeCollection.name}</h3>
              {selectedCollectionId === activeCollection.id && (
                <span className="current-version-badge">Current collection</span>
              )}
            </div>
            {prompts.map((item) => (
              <div className="collection-member-row" key={item.id}>
                <span>{item.title}</span>
                {selectedCollectionId === activeCollection.id && (
                  collectionPromptIds.includes(item.id) ? (
                    <button className="text-action" type="button" onClick={() => onRemovePrompt(activeCollection.id, item.id)}>Remove</button>
                  ) : (
                    <button className="text-action" type="button" onClick={() => onAddPrompt(activeCollection.id, item.id)}>Add</button>
                  )
                )}
              </div>
            ))}
            {activeCollection.isPublic && activeCollection.shareId && (
              <a
                className="public-link"
                href={`/share/collection/${activeCollection.shareId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open public read-only collection ↗
              </a>
            )}
          </div>
        )}

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  )
}

function SharedPage({ type, shareId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const endpoint =
      type === 'prompt'
        ? `/api/public/prompts/${encodeURIComponent(shareId)}`
        : `/api/public/collections/${encodeURIComponent(shareId)}`

    fetch(`${API_URL}${endpoint}`)
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.message || 'This shared page is unavailable.')
        return body
      })
      .then((body) => {
        if (active) setData(body)
      })
      .catch((fetchError) => {
        if (active) setError(fetchError.message)
      })

    return () => {
      active = false
    }
  }, [shareId, type])

  const prompts = type === 'prompt' ? (data?.prompt ? [data.prompt] : []) : data?.prompts || []

  async function copy(content) {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      setError('Clipboard access failed. Select and copy the prompt text manually.')
    }
  }

  return (
    <main className="shared-page">
      <header className="shared-header">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>prompt<span className="brand-light">vault</span></span>
        </a>
        <span className="read-only-badge">Read-only shared page</span>
      </header>
      <section className="shared-content">
        {error ? (
          <div className="empty-state">
            <h1>Shared page unavailable</h1>
            <p>{error}</p>
          </div>
        ) : !data ? (
          <div className="loading-state">Loading shared {type}...</div>
        ) : (
          <>
            <p className="eyebrow">{type === 'collection' ? 'SHARED COLLECTION' : 'SHARED PROMPT'}</p>
            <h1>{type === 'collection' ? data.collection.name : data.prompt.title}</h1>
            {(type === 'collection' ? data.collection.description : data.prompt.description) && (
              <p className="shared-description">
                {type === 'collection' ? data.collection.description : data.prompt.description}
              </p>
            )}
            <div className="shared-prompt-list">
              {prompts.map((prompt, index) => (
                <article className="shared-prompt-card" key={`${prompt.title}-${index}`}>
                  {type === 'collection' && <span className="prompt-category">{prompt.category}</span>}
                  <h2>{prompt.title}</h2>
                  {prompt.description && <p>{prompt.description}</p>}
                  <pre>{prompt.content}</pre>
                  {prompt.tags?.length > 0 && (
                    <div className="tag-row">
                      {prompt.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
                    </div>
                  )}
                  <button className="primary-button" type="button" onClick={() => copy(prompt.content)}>
                    Copy prompt
                  </button>
                </article>
              ))}
              {type === 'collection' && prompts.length === 0 && (
                <div className="empty-state"><p>No public prompts in this collection yet.</p></div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function FeaturedPromptsPage() {
  const [prompts, setPrompts] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    const params = new URLSearchParams({ page: String(page), search, category })
    const debounce = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`${API_URL}/api/public/prompts/featured?${params}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Could not load featured prompts.')
        if (active) {
          setPrompts(data.prompts || [])
          setCategories(data.categories || [])
          setPagination(data.pagination || { page: 1, pages: 0, total: 0 })
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Could not load featured prompts.')
      } finally {
        if (active) setLoading(false)
      }
    }, 180)
    return () => {
      active = false
      window.clearTimeout(debounce)
    }
  }, [page, search, category])

  async function copyPrompt(content) {
    try {
      await navigator.clipboard.writeText(content)
      setNotice('Prompt copied to clipboard.')
    } catch {
      setError('Clipboard access failed. Select and copy the prompt text manually.')
    }
  }

  return (
    <main className="featured-page">
      <header className="featured-header">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>prompt<span className="brand-light">vault</span></span>
        </a>
        <div className="featured-header-actions">
          <span className="read-only-badge">Community prompts</span>
          <a className="primary-button featured-login-link" href="/">Log in</a>
        </div>
      </header>
      <section className="featured-content">
        <div className="featured-intro">
          <p className="eyebrow">PROMPTVAULT COMMUNITY</p>
          <h1>Featured prompts</h1>
          <p>Browse useful prompts selected by the PromptVault team. Only approved prompts shared publicly by their owners appear here.</p>
        </div>
        <form className="featured-toolbar" onSubmit={(event) => event.preventDefault()}>
          <label className="featured-search">
            <span className="visually-hidden">Search featured prompts</span>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1) }}
              maxLength={100}
              placeholder="Search prompts, topics, or tags"
            />
          </label>
          <label>
            <span className="visually-hidden">Filter by category</span>
            <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>
              <option value="">All categories</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </form>
        {notice && <div className="auth-message featured-notice" role="status">{notice}</div>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        {loading ? (
          <p className="loading-state" role="status">Loading featured prompts...</p>
        ) : prompts.length ? (
          <div className="featured-grid">
            {prompts.map((prompt, index) => (
              <article className="featured-card" key={`${prompt.title}-${index}`}>
                <div className="featured-card-heading">
                  <div>
                    <span className="featured-category">{prompt.category}</span>
                    <h2>{prompt.title}</h2>
                  </div>
                  <span className="featured-star" aria-label="Featured">★</span>
                </div>
                {prompt.description && <p className="featured-description">{prompt.description}</p>}
                <pre>{prompt.content}</pre>
                {prompt.tags?.length > 0 && (
                  <div className="featured-tags">
                    {prompt.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                  </div>
                )}
                <footer>
                  <span>{prompt.updatedAt ? `Updated ${formatDate(prompt.updatedAt)}` : ''}</span>
                  <button className="secondary-button" type="button" onClick={() => copyPrompt(prompt.content)}>Copy prompt</button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state featured-empty">
            <span className="empty-icon" aria-hidden="true">✦</span>
            <h2>{search || category ? 'No matching featured prompts' : 'No featured prompts yet'}</h2>
            <p>{search || category ? 'Try changing your search or category filter.' : 'Check back later for prompts curated by the PromptVault team.'}</p>
          </div>
        )}
        {pagination.pages > 1 && (
          <footer className="featured-pagination">
            <span>{pagination.total} prompts · Page {pagination.page} of {pagination.pages}</span>
            <div>
              <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>Previous</button>
              <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))} disabled={page >= pagination.pages || loading}>Next</button>
            </div>
          </footer>
        )}
      </section>
    </main>
  )
}

export default App
