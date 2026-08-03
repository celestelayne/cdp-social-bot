import { FormEvent, useEffect, useState } from 'react'
import './App.css'

type DiscordUser = {
  id: string
  username: string
  globalName: string | null
  avatar: string | null
}

type SessionResponse =
  | {
      authenticated: false
    }
  | {
      authenticated: true
      user: DiscordUser
    }

type ProfileForm = {
  displayName: string
  pronunciation: string
  favoriteDrink: string
  dietaryNotes: string
  interests: string
  published: boolean
}

const emptyProfile: ProfileForm = {
  displayName: '',
  pronunciation: '',
  favoriteDrink: '',
  dietaryNotes: '',
  interests: '',
  published: false,
}

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch('/api/session')

        if (!response.ok) {
          throw new Error('Unable to check your login status.')
        }

        const data = (await response.json()) as SessionResponse
        setSession(data)

        if (data.authenticated) {
          setProfile((current) => ({
            ...current,
            displayName: data.user.globalName ?? data.user.username,
          }))
        }
      } catch {
        setError('Unable to connect to the application.')
        setSession({ authenticated: false })
      }
    }

    void loadSession()
  }, [])

  function updateField<Key extends keyof ProfileForm>(
    key: Key,
    value: ProfileForm[Key],
  ) {
    setProfile((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profile),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null

        throw new Error(data?.error ?? 'Unable to save your profile.')
      }

      setMessage('Your profile has been saved.')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to save your profile.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleLogout() {
    await fetch('/auth/logout', {
      method: 'POST',
    })

    window.location.reload()
  }

  if (session === null) {
    return (
      <main className="app-shell">
        <section className="card status-card">
          <p>Loading…</p>
        </section>
      </main>
    )
  }

  if (!session.authenticated) {
    return (
      <main className="app-shell">
        <section className="card welcome-card">
          <p className="eyebrow">GSAPP CDP</p>
          <h1>Create your studio profile</h1>
          <p className="intro">
            Share the information that helps classmates address, include, and
            collaborate with you.
          </p>

          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          <a className="primary-button" href="/auth/discord">
            Sign in with Discord
          </a>

          <p className="privacy-note">
            Your Discord account is used only to associate this profile with
            you.
          </p>
        </section>
      </main>
    )
  }

  const userName = session.user.globalName ?? session.user.username

  return (
    <main className="app-shell">
      <section className="card form-card">
        <header className="form-header">
          <div>
            <p className="eyebrow">CDP Social Bot</p>
            <h1>Your studio profile</h1>
            <p className="intro">
              Signed in as <strong>{userName}</strong>
            </p>
          </div>

          <button className="text-button" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="display-name">Preferred name</label>
            <input
              id="display-name"
              name="displayName"
              value={profile.displayName}
              onChange={(event) =>
                updateField('displayName', event.target.value)
              }
              required
            />
            <p className="field-hint">
              The name classmates should use when addressing you.
            </p>
          </div>

          <div className="field">
            <label htmlFor="pronunciation">Name pronunciation</label>
            <input
              id="pronunciation"
              name="pronunciation"
              value={profile.pronunciation}
              onChange={(event) =>
                updateField('pronunciation', event.target.value)
              }
              placeholder="For example: suh-LEST"
            />
          </div>

          <div className="field">
            <label htmlFor="favorite-drink">Favorite coffee or tea</label>
            <input
              id="favorite-drink"
              name="favoriteDrink"
              value={profile.favoriteDrink}
              onChange={(event) =>
                updateField('favoriteDrink', event.target.value)
              }
              placeholder="For example: oat milk latte"
            />
          </div>

          <div className="field">
            <label htmlFor="dietary-notes">Dietary information</label>
            <textarea
              id="dietary-notes"
              name="dietaryNotes"
              value={profile.dietaryNotes}
              onChange={(event) =>
                updateField('dietaryNotes', event.target.value)
              }
              rows={3}
              placeholder="Share only what you want classmates to know."
            />
            <p className="field-hint">This field is optional.</p>
          </div>

          <div className="field">
            <label htmlFor="interests">Ask me about</label>
            <textarea
              id="interests"
              name="interests"
              value={profile.interests}
              onChange={(event) =>
                updateField('interests', event.target.value)
              }
              rows={4}
              placeholder="Adaptive reuse, model making, public space…"
            />
          </div>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={profile.published}
              onChange={(event) =>
                updateField('published', event.target.checked)
              }
            />
            <span>Make my profile visible to classmates in Discord</span>
          </label>

          {message && (
            <p className="success-message" role="status">
              {message}
            </p>
          )}

          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          <button
            className="primary-button"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default App