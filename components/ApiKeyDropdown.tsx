'use client'

import { useEffect, useRef, useState } from 'react'
import {
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Trash2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'

export function ApiKeyDropdown() {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [savedToken, setSavedToken] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [hasLimitError, setHasLimitError] = useState(false)
  const [limitErrorMessage, setLimitErrorMessage] = useState<string | null>(null)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored =
        localStorage.getItem('gradesight_hf_token') ||
        localStorage.getItem('HF_TOKEN') ||
        null
      if (stored) {
        setSavedToken(stored)
        setToken(stored)
      }
    }
  }, [])

  // Listen for global HF key error notifications or open requests
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleKeyError = (e: CustomEvent<{ message?: string }>) => {
      setHasLimitError(true)
      if (e.detail?.message) {
        setLimitErrorMessage(e.detail.message)
      }
    }

    const handleOpenSettings = () => {
      setOpen(true)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 100)
    }

    const handleKeyUpdated = () => {
      setHasLimitError(false)
      setLimitErrorMessage(null)
    }

    window.addEventListener('gradesight:hf-key-error', handleKeyError as EventListener)
    window.addEventListener('gradesight:open-hf-settings', handleOpenSettings as EventListener)
    window.addEventListener('gradesight:hf-key-updated', handleKeyUpdated as EventListener)

    return () => {
      window.removeEventListener('gradesight:hf-key-error', handleKeyError as EventListener)
      window.removeEventListener('gradesight:open-hf-settings', handleOpenSettings as EventListener)
      window.removeEventListener('gradesight:hf-key-updated', handleKeyUpdated as EventListener)
    }
  }, [])

  // Close dropdown on outside click or escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleTestKey = async () => {
    if (!token.trim()) {
      setTestResult({
        ok: false,
        message: 'Please enter a Hugging Face token to test.',
      })
      return
    }

    setLoading(true)
    setTestResult(null)
    setSaveSuccess(false)

    try {
      const res = await fetch('/api/test-hf-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await res.json()

      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          message: data.message || `Token verified successfully! (${data.user})`,
        })
        setHasLimitError(false)
        setLimitErrorMessage(null)
      } else {
        setTestResult({
          ok: false,
          message: data.error || 'Token validation failed. Please check permissions or rate limits.',
        })
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Network error testing token.',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) {
      setTestResult({
        ok: false,
        message: 'Please enter a valid token before submitting.',
      })
      return
    }

    setSubmitting(true)
    setTestResult(null)
    setSaveSuccess(false)

    try {
      // Validate key with Hugging Face API before allowing submission
      const res = await fetch('/api/test-hf-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmed }),
      })
      const data = await res.json()

      if (res.ok && data.ok) {
        localStorage.setItem('gradesight_hf_token', trimmed)
        localStorage.setItem('HF_TOKEN', trimmed)
        setSavedToken(trimmed)
        setHasLimitError(false)
        setLimitErrorMessage(null)
        setSaveSuccess(true)
        setTestResult({
          ok: true,
          message: data.message || 'Hugging Face API key verified and saved successfully!',
        })
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gradesight:hf-key-updated', { detail: { token: trimmed } }))
        }
        setTimeout(() => {
          setSaveSuccess(false)
        }, 3000)
      } else {
        // Prevent submission when limit reached or key invalid
        setTestResult({
          ok: false,
          message: data.error || 'Cannot submit key: Token validation failed or limit reached.',
        })
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Network error validating token. Could not submit key.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleClear = () => {
    localStorage.removeItem('gradesight_hf_token')
    localStorage.removeItem('HF_TOKEN')
    setSavedToken(null)
    setToken('')
    setTestResult(null)
    setSaveSuccess(false)
    setHasLimitError(false)
    setLimitErrorMessage(null)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gradesight:hf-key-updated', { detail: { token: null } }))
    }
  }

  const hasKey = Boolean(savedToken)

  return (
    <div className="api-key-container" ref={dropdownRef}>
      <button
        type="button"
        className={`api-key-trigger ${hasLimitError ? 'limit-warning' : hasKey ? 'active' : ''} ${open ? 'opened' : ''}`}
        onClick={() => {
          setOpen((v) => !v)
          setTestResult(null)
        }}
        title={
          hasLimitError
            ? '⚠️ Hugging Face limit reached or key error. Click to configure a working key.'
            : 'Configure Hugging Face API Key'
        }
        aria-expanded={open}
        aria-haspopup="true"
      >
        {hasLimitError ? (
          <AlertTriangle size={15} className="key-icon warning-icon" />
        ) : (
          <KeyRound size={15} className="key-icon" />
        )}
        <span className="api-key-label">HF Key</span>
        {hasLimitError && <span className="api-key-limit-tag">Limit Exceeded</span>}
        <span
          className={`api-key-dot ${hasLimitError ? 'limit-error' : hasKey ? 'active' : ''}`}
        />
      </button>

      {open && (
        <div className="api-key-dropdown" role="dialog" aria-label="API Key Settings">
          <div className="api-key-header">
            <div className="api-key-title-group">
              <KeyRound size={16} className="api-key-title-icon" />
              <div>
                <b className="api-key-title">Hugging Face API Key</b>
                <p className="api-key-desc">
                  Used for vision-language document extraction &amp; AI evaluation
                </p>
              </div>
            </div>
            <span
              className={`api-key-badge ${
                hasLimitError
                  ? 'limit-error'
                  : hasKey
                    ? 'configured'
                    : 'unconfigured'
              }`}
            >
              {hasLimitError ? 'Limit Reached' : hasKey ? 'Active' : 'Not Set'}
            </span>
          </div>

          {hasLimitError && !testResult && (
            <div className="api-key-limit-alert" role="alert">
              <AlertCircle size={15} className="limit-alert-icon" />
              <div className="limit-alert-content">
                <b>API Limit Reached or Key Issue</b>
                <p>
                  {limitErrorMessage ||
                    'Your Hugging Face API key has reached its rate or usage limit. Please enter an active token below to continue.'}
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="api-key-form">
            <label className="api-key-input-label" htmlFor="hf-token-input">
              Access Token (Inference Provider enabled)
            </label>
            <div className={`api-key-input-wrap ${hasLimitError ? 'has-error' : ''}`}>
              <input
                id="hf-token-input"
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setTestResult(null)
                }}
                placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="api-key-input"
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="button"
                className="api-key-visibility-btn"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Hide token' : 'Show token'}
                aria-label={showPassword ? 'Hide token' : 'Show token'}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            <div className="api-key-helper">
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="api-key-link"
              >
                <span>Get fine-grained token at Hugging Face</span>
                <ExternalLink size={11} />
              </a>
            </div>

            {testResult && (
              <div
                className={`api-key-result ${testResult.ok ? 'success' : 'error'}`}
                role="status"
              >
                {testResult.ok ? (
                  <CheckCircle2 size={14} className="result-icon success-icon" />
                ) : (
                  <AlertCircle size={14} className="result-icon error-icon" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="api-key-actions">
              <button
                type="button"
                className="btn-test-key"
                onClick={handleTestKey}
                disabled={loading || submitting || !token.trim()}
              >
                {loading ? (
                  <>
                    <Loader2 size={13} className="spin" />
                    <span>Testing…</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    <span>Test Key</span>
                  </>
                )}
              </button>

              <button
                type="submit"
                className="btn-submit-key"
                disabled={loading || submitting || !token.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 size={13} className="spin" />
                    <span>Verifying…</span>
                  </>
                ) : saveSuccess ? (
                  <>
                    <CheckCircle2 size={13} />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Submit Key</span>
                )}
              </button>
            </div>

            {hasKey && (
              <div className="api-key-footer">
                <button
                  type="button"
                  className="api-key-clear-btn"
                  onClick={handleClear}
                >
                  <Trash2 size={12} />
                  <span>Remove saved API key</span>
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
