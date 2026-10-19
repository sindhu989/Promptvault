import { useEffect, useState } from 'react'
import './VerifyEmail.css'

const EMAILJS_PUBLIC_KEY = 'jBaRIsY0Mi4jEvRft'
const EMAILJS_SERVICE_ID = 'service_fgd57hn'
const EMAILJS_TEMPLATE_ID = 'template_r8jcg5h'
const OTP_VALIDITY_MS = 15 * 60 * 1000
let pendingVerificationMemory = null

function readPendingVerification() {
  try {
    const pending = pendingVerificationMemory
    if (
      pending &&
      typeof pending.name === 'string' &&
      typeof pending.email === 'string' &&
      typeof pending.otp === 'string' &&
      /^\d{6}$/.test(pending.otp) &&
      Number.isFinite(pending.expiresAt) &&
      pending.expiresAt > Date.now()
    ) {
      return pending
    }
    pendingVerificationMemory = null
  } catch {
    pendingVerificationMemory = null
  }
  return null
}

function BrandMark() {
  return (
    <a className="verify-brand" href="/" aria-label="PromptVault home">
      <span className="verify-brand-mark">P</span>
      <span>prompt<span>vault</span></span>
    </a>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
      <path d="m5 7 7 5.5L19 7" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 39 10v11c0 10.2-6.2 18.3-15 23-8.8-4.7-15-12.8-15-23V10L24 4Z" />
      <path d="m17.5 23.5 4.3 4.3 9-9" />
    </svg>
  )
}

function VerifyEmail() {
  const [initialPending] = useState(readPendingVerification)
  const [name, setName] = useState(() => initialPending?.name || '')
  const [email, setEmail] = useState(() => initialPending?.email || '')
  const [otp, setOtp] = useState('')
  const [generatedOtp, setGeneratedOtp] = useState(() => initialPending?.otp || '')
  const [step, setStep] = useState(() => initialPending ? 'code' : 'details')
  const [message, setMessage] = useState(() =>
    initialPending ? `A verification code is pending for ${initialPending.email}.` : '',
  )
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    if (window.emailjs) {
      window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY })
    }
  }, [])

  async function handleSendCode(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    setMessage('')

    if (!window.emailjs) {
      setError('Email service could not load. Refresh the page and try again.')
      setPending(false)
      return
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString()
    try {
      await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        name,
        email,
        otp: code,
      })
      const pending = {
        name,
        email,
        otp: code,
        expiresAt: Date.now() + OTP_VALIDITY_MS,
      }
      pendingVerificationMemory = pending
      setGeneratedOtp(code)
      setStep('code')
      setMessage(`A verification code was sent to ${email}.`)
    } catch (sendError) {
      console.error('Email verification code could not be sent:', sendError)
      const details = [
        sendError?.status ? `Error ${sendError.status}.` : '',
        typeof sendError?.text === 'string' ? sendError.text : '',
      ].filter(Boolean).join(' ')
      setError(details
        ? `We couldn’t send the code. ${details}`
        : 'We couldn’t send the code. Please check your EmailJS service and template settings, then try again.')
    } finally {
      setPending(false)
    }
  }

  function handleVerifyCode(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (Date.now() > (readPendingVerification()?.expiresAt || 0)) {
      setGeneratedOtp('')
      setOtp('')
      setStep('details')
      setError('That code has expired. Send a new verification code.')
      return
    }
    if (otp !== generatedOtp) {
      setError('That code doesn’t match. Check your email and try again.')
      return
    }
    pendingVerificationMemory = null
    setVerified(true)
  }

  return (
    <main className="verify-page">
      <section className="verify-layout" aria-labelledby="verify-title">
        <aside className="verify-story">
          <div className="verify-story-glow" />
          <BrandMark />

          <div className="verify-story-content">
            <span className="verify-eyebrow">A little extra peace of mind</span>
            <div className="verify-illustration">
              <div className="verify-orbit verify-orbit-one" />
              <div className="verify-orbit verify-orbit-two" />
              <div className="verify-shield">
                <ShieldIcon />
              </div>
              <span className="verify-spark verify-spark-one">✦</span>
              <span className="verify-spark verify-spark-two">✧</span>
            </div>
            <h2>Your ideas deserve a safe place.</h2>
            <p>
              Verify your email to keep your PromptVault account secure and your
              favorite prompts close at hand.
            </p>
          </div>

          <div className="verify-story-footer">
            <span className="verify-footer-dot" />
            Your creative workspace, all in one place
          </div>
        </aside>

        <div className="verify-form-panel">
          <div className="verify-form-wrap">
            <div className="verify-mobile-brand"><BrandMark /></div>

            <div className="verify-stepper" aria-label={`Step ${step === 'details' ? 1 : 2} of 2`}>
              <div className={`verify-step${step === 'details' ? ' verify-step-active' : ' verify-step-complete'}`}>
                <span>1</span>
                <span>Your details</span>
              </div>
              <span className="verify-step-line" />
              <div className={`verify-step${step === 'code' ? ' verify-step-active' : ''}`}>
                <span>2</span>
                <span>Email code</span>
              </div>
            </div>

            <span className="verify-kicker">{step === 'details' ? "LET'S GET YOU STARTED" : 'ONE LAST STEP'}</span>
            <h1 id="verify-title">{verified ? 'Email verified' : step === 'details' ? 'Verify your email' : 'Check your inbox'}</h1>
            <p className="verify-intro">
              {verified
                ? 'Your email address has been confirmed.'
                : step === 'details'
                  ? 'Enter your details and we’ll send a one-time code to your inbox.'
                  : `Enter the 6-digit code we sent to ${email}.`}
            </p>

            {verified ? (
              <div className="verify-success" role="status">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>All set, {name}.</strong>
                  <p>{email} is verified for this demo only.</p>
                </div>
              </div>
            ) : (
              <form className="verify-form" onSubmit={step === 'details' ? handleSendCode : handleVerifyCode}>
                {step === 'details' ? (
                  <>
                    <label htmlFor="verify-name">Your name</label>
                    <input
                      autoComplete="name"
                      id="verify-name"
                      maxLength={80}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Alex Morgan"
                      required
                      value={name}
                    />

                    <label htmlFor="verify-email">Email address</label>
                    <div className="verify-input-wrap">
                      <span className="verify-input-icon"><MailIcon /></span>
                      <input
                        autoComplete="email"
                        id="verify-email"
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@example.com"
                        required
                        type="email"
                        value={email}
                      />
                    </div>
                    <p className="verify-field-hint">Use an address you can access right now.</p>
                  </>
                ) : (
                  <>
                    <label htmlFor="verify-otp">6-digit verification code</label>
                    <input
                      autoComplete="one-time-code"
                      className="verify-code-input"
                      id="verify-otp"
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      pattern="[0-9]{6}"
                      placeholder="000000"
                      required
                      value={otp}
                    />
                    <p className="verify-field-hint">Check your inbox and spam folder for the code.</p>
                  </>
                )}

                {error && <p className="verify-error-message" role="alert">{error}</p>}
                {message && <p className="verify-preview-message" role="status">{message}</p>}

                <button className="verify-submit" disabled={pending} type="submit">
                  {pending ? 'Sending code…' : step === 'details' ? 'Send verification code' : 'Verify email'}
                  {!pending && <span aria-hidden="true">→</span>}
                </button>
                {step === 'code' && (
                  <button
                    className="verify-edit-link"
                    onClick={() => {
                      pendingVerificationMemory = null
                      setGeneratedOtp('')
                      setMessage('')
                      setStep('details')
                      setOtp('')
                      setError('')
                    }}
                    type="button"
                  >
                    ← Change email address
                  </button>
                )}
              </form>
            )}

            <p className="verify-terms">
              By continuing, you agree to keep your account details private and secure.
            </p>
            <a className="verify-back-link" href="/">← Back to PromptVault</a>
          </div>
        </div>
      </section>
    </main>
  )
}

export default VerifyEmail
