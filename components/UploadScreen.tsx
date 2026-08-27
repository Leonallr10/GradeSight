'use client'

import { ChangeEvent, MouseEvent, useEffect, useRef, useState } from 'react'
import { ChartPie, Settings, ClipboardList, ArrowLeft, Sparkles, PanelLeft, PanelRight } from 'lucide-react'
import { IoDocumentTextOutline } from 'react-icons/io5'
import { IoMdNotificationsOutline } from 'react-icons/io'
import { FaRegQuestionCircle } from 'react-icons/fa'

type FileKind = 'question' | 'answer'

const UPLOAD_DELAY_MS = 2000

function FileCard({
  kind,
  file,
  onFile,
}: {
  kind: FileKind
  file: File | null
  onFile: (file: File | null) => void
}) {
  const label = kind === 'question' ? 'Question Paper' : 'Answer Sheet'
  const isImage = file?.type.startsWith('image/')
  const [loading, setLoading] = useState(false)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => () => clearTimer(), [])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0]
    if (!next) return
    clearTimer()
    setLoading(true)
    setPendingName(next.name)
    timerRef.current = setTimeout(() => {
      onFile(next)
      setLoading(false)
      setPendingName(null)
      timerRef.current = null
    }, UPLOAD_DELAY_MS)
    e.target.value = ''
  }

  const handleRemove = (e: MouseEvent) => {
    e.preventDefault()
    clearTimer()
    setLoading(false)
    setPendingName(null)
    onFile(null)
  }

  if (loading) {
    return (
      <div
        className="upload-box loading"
        aria-busy="true"
        aria-live="polite"
        aria-label={`Uploading ${label}`}
      >
        <span className="upload-loading-spinner" aria-hidden="true" />
        <b>Uploading {label}…</b>
        {pendingName && <small className="upload-loading-name">{pendingName}</small>}
        <div className="upload-loading-bar" aria-hidden="true">
          <span className="upload-loading-bar-fill" />
        </div>
      </div>
    )
  }

  return (
    <label className={`upload-box ${file ? 'filled' : ''}`}>
      <input
        type="file"
        accept=".pdf,.jpeg,.jpg,.png,application/pdf,image/jpeg,image/png"
        onChange={handleChange}
      />
      {file ? (
        <>
          <span className="file-icon">{isImage ? 'IMG' : 'PDF'}</span>
          <span className="file-info">
            <b>{file.name}</b>
            <small>{Math.max(1, Math.round(file.size / 1024))} KB · Ready</small>
          </span>
          <button
            type="button"
            className="remove"
            aria-label={`Remove ${label}`}
            onClick={handleRemove}
          >
            ×
          </button>
        </>
      ) : (
        <>
          <span className="upload-icon-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/upload.png" alt="" className="upload-icon-img" />
          </span>
          <b>
            Upload <em>{label}</em>
          </b>
          <small>Max 10MB</small>
        </>
      )}
    </label>
  )
}

export function UploadScreen({
  files,
  onStart,
  setFile,
  error,
}: {
  files: Record<FileKind, File | null>
  onStart: () => void
  setFile: (kind: FileKind, file: File | null) => void
  error?: string | null
}) {
  const filled = Boolean(files.question && files.answer)
  return (
    <div className="upload-screen">
      <div className="upload-header">
        <h1>
          Upload <span>Question Paper &amp; Answer Sheets</span>
        </h1>
        <p className="subtitle">Upload both files to get started</p>
      </div>
      <div className="teacher-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/teacher.png" alt="AI Teacher" className="teacher-img" />
      </div>
      <div className="upload-grid">
        <FileCard
          kind="question"
          file={files.question}
          onFile={(f) => setFile('question', f)}
        />
        <FileCard
          kind="answer"
          file={files.answer}
          onFile={(f) => setFile('answer', f)}
        />
      </div>
      <div className="upload-actions">
        <button className="primary" disabled={!filled} onClick={onStart}>
          Start Mapping <span>→</span>
        </button>
        {error && <p className="upload-error">{error}</p>}
        <p className="hint">
          Once both files are uploaded, you&apos;ll be able to map answers with questions
        </p>
      </div>
    </div>
  )
}

export function Sidebar({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean
  onToggle?: () => void
}) {
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo.png" alt="VedaAI logo" className="brand-logo" />
          {!collapsed && <strong>VedaAI</strong>}
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            {collapsed ? (
              <PanelRight size={18} strokeWidth={1.75} aria-hidden />
            ) : (
              <PanelLeft size={18} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
        {collapsed ? (
          <button type="button" className="toolkit icon-only" aria-label="AI Teacher's Toolkit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/generate.png" alt="" className="toolkit-spark" aria-hidden />
          </button>
        ) : (
          <button type="button" className="toolkit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/generate.png" alt="" className="toolkit-spark" aria-hidden />
            AI Teacher&apos;s Toolkit
          </button>
        )}
        <nav aria-label="Main navigation">
          <a title="Home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/home-Icon.png" alt="" className="nav-asset" />
            {!collapsed && <span>Home</span>}
          </a>
          <a title="My Classroom">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/classroom.png" alt="" className="nav-asset" />
            {!collapsed && <span>My Classroom</span>}
          </a>
          <a title="Assignments">
            <IoDocumentTextOutline size={18} className="nav-lib-icon" />
            {!collapsed && <span>Assignments</span>}
          </a>
          <a className="active" title="Exams">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/exam.png" alt="" className="nav-asset" />
            {!collapsed && <span>Exams</span>}
          </a>
          <a title="My Library">
            <ChartPie size={18} className="nav-lib-icon" strokeWidth={1.75} />
            {!collapsed && <span>My Library</span>}
          </a>
        </nav>
      </div>
      <div className="sidebar-bottom">
        <a className="settings" title="Settings">
          <Settings size={18} className="nav-lib-icon" strokeWidth={1.75} />
          {!collapsed && <span>Settings</span>}
        </a>
        <div className="school">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/school.png" alt="" className="school-logo" />
          {!collapsed && (
            <div>
              <b>Delhi Public School</b>
              <small>Bokaro Steel City</small>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

export function Topbar({
  mobile = false,
  onBack,
}: {
  mobile?: boolean
  onBack: () => void
}) {
  return (
    <header className={`topbar ${mobile ? 'mobile-topbar' : ''}`}>
      <button className="back" aria-label="Go back" onClick={onBack}>
        ‹
      </button>
      {!mobile && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/exam.png" alt="" className="nav-asset sm" />
          <span className="muted">Exams</span>
        </>
      )}
      {mobile && (
        <strong className="mobile-brand">
          <span className="brand-mark sm">V</span> VedaAI
        </strong>
      )}
      <div className="top-actions">
        {!mobile && (
          <span className="top-help" aria-label="Help">
            <FaRegQuestionCircle size={16} />
          </span>
        )}
        <span className="bell" aria-label="Notifications">
          <IoMdNotificationsOutline size={18} />
          <i />
        </span>
        {!mobile && (
          <span className="top-spark" aria-label="AI">
            <Sparkles size={15} />
          </span>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/profile.png" alt="" className="avatar-img" />
        {!mobile && <span className="user">Madhur Rastogi ⌄</span>}
        {mobile && <span className="menu">≡</span>}
      </div>
    </header>
  )
}
