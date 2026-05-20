import { useState, useRef, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import Dashboard from './components/Dashboard'
import Incidents, { IncidentDetail } from './components/Incidents'
import Analytics from './components/Analytics'
import Reports   from './components/Reports'
import Settings  from './components/Settings'
import Agents    from './components/Agents'
import Skills     from './components/Skills'
import Documents  from './components/Documents'
import './App.css'

const NAV_ITEMS = [
  { icon: '▦', label: 'Dashboard' },
  { icon: '⚠', label: 'Incidents' },
  { icon: '⬡', label: 'Analytics' },
  { icon: '≡', label: 'Reports'   },
  { icon: '◈', label: 'Agents'    },
  { icon: '✦', label: 'Skills'     },
  { icon: '◫', label: 'Documents' },
  { icon: '⚙', label: 'Settings'  },
]

const CHAT_MIN     = 48
const CHAT_MAX     = 600
const CHAT_DEFAULT = 220

const COMMANDS = [
  { cmd: 'clear',          desc: 'Clear the entire conversation' },
  { cmd: 'help',           desc: 'List all available commands' },
  { cmd: 'restart-server', desc: 'Restart the Express API server' },
]

const INITIAL_MESSAGES = [
  { role: 'ai', text: 'SYSTEM ONLINE — BlueAgent AI ready. How can I assist?' },
]

function CommandPicker({ commands, activeIdx, onSelect }) {
  if (commands.length === 0) return null
  return (
    <div className="cmd-picker">
      {commands.map((c, i) => (
        <button
          key={c.cmd}
          className={`cmd-item ${i === activeIdx ? 'cmd-item-active' : ''}`}
          onMouseDown={e => { e.preventDefault(); onSelect(c) }}
        >
          <span className="cmd-name">/{c.cmd}</span>
          <span className="cmd-desc">{c.desc}</span>
        </button>
      ))}
    </div>
  )
}

function ChatPanel({ expandRef, setSuggestedPrompts, setSuggesting }) {
  const [height, setHeight]     = useState(CHAT_DEFAULT)
  const [expanded, setExpanded] = useState(true)
  const [messages, setMessages] = useState(INITIAL_MESSAGES)
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showCmds, setShowCmds] = useState(false)
  const [cmdIdx, setCmdIdx]     = useState(0)

  const [pendingImages, setPendingImages] = useState([])

  const startY      = useRef(0)
  const startH      = useRef(0)
  const bottomRef   = useRef(null)
  const fileInputRef = useRef(null)
  const sendTextRef  = useRef(null)
  const investigationRef = useRef(null) // { number, rawContext } stored after investigation, used by refreshSuggestions
  const historyRef  = useRef([])   // sent user messages
  const histIdxRef  = useRef(-1)   // -1 = not browsing history
  const draftRef    = useRef('')   // saved draft while browsing history

  useEffect(() => {
    if (!expandRef) return
    expandRef.current = {
      expand: () => { setHeight(CHAT_DEFAULT); setExpanded(true) },
      sendPrompt: (text) => { setHeight(CHAT_DEFAULT); setExpanded(true); sendTextRef.current?.(text) },
      reset: () => {
        investigationRef.current = null
        setMessages(INITIAL_MESSAGES)
        setInput('')
        setPendingImages([])
        setLoading(false)
      },
      applyInvestigation: ({ incidentNumber, fullContext }) => {
        setHeight(CHAT_DEFAULT); setExpanded(true)
        investigationRef.current = { number: incidentNumber, rawContext: fullContext }
      },
    }
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const onDragStart = useCallback((e) => {
    startY.current = e.clientY
    startH.current = height
    const onMove = ev => {
      const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, startH.current + (startY.current - ev.clientY)))
      setHeight(next)
      setExpanded(next > CHAT_MIN + 10)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [height])

  const toggle = () => {
    if (expanded) { setHeight(CHAT_MIN); setExpanded(false) }
    else          { setHeight(CHAT_DEFAULT); setExpanded(true) }
  }

  const filteredCmds = input.startsWith('/')
    ? COMMANDS.filter(c => c.cmd.startsWith(input.slice(1).toLowerCase()))
    : []

  const executeCommand = cmd => {
    setInput('')
    setShowCmds(false)
    histIdxRef.current = -1
    if (cmd.cmd === 'clear') {
      setMessages(INITIAL_MESSAGES)
    } else if (cmd.cmd === 'help') {
      setMessages(prev => [...prev, {
        role: 'ai',
        text: `**Available commands**\n\n${COMMANDS.map(c => `\`/${c.cmd}\` — ${c.desc}`).join('\n')}`,
      }])
    } else if (cmd.cmd === 'restart-server') {
      setMessages(prev => [...prev, { role: 'ai', text: 'Restarting API server…' }])
      fetch('/api/restart', { method: 'POST' })
        .then(() => setMessages(prev => [...prev, { role: 'ai', text: 'API server restarted.' }]))
        .catch(() => setMessages(prev => [...prev, { role: 'ai', text: 'ERROR: Could not reach the API server.' }]))
    }
  }

  const handleInputChange = e => {
    const val = e.target.value
    setInput(val)
    histIdxRef.current = -1
    if (val.startsWith('/')) {
      setShowCmds(true)
      setCmdIdx(0)
    } else {
      setShowCmds(false)
    }
  }

  const handleKeyDown = e => {
    // ── Command picker navigation ──
    if (showCmds && filteredCmds.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdIdx(i => Math.min(i + 1, filteredCmds.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        executeCommand(filteredCmds[cmdIdx])
        return
      }
      if (e.key === 'Escape') {
        setShowCmds(false)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setInput('/' + filteredCmds[cmdIdx].cmd + ' ')
        setShowCmds(false)
        return
      }
    }

    // ── History navigation ──
    if (e.key === 'ArrowUp' && !showCmds) {
      const hist = historyRef.current
      if (hist.length === 0) return
      e.preventDefault()
      if (histIdxRef.current === -1) {
        draftRef.current = input
        histIdxRef.current = hist.length - 1
      } else if (histIdxRef.current > 0) {
        histIdxRef.current--
      }
      setInput(hist[histIdxRef.current])
      return
    }
    if (e.key === 'ArrowDown' && !showCmds) {
      if (histIdxRef.current === -1) return
      e.preventDefault()
      if (histIdxRef.current < historyRef.current.length - 1) {
        histIdxRef.current++
        setInput(historyRef.current[histIdxRef.current])
      } else {
        histIdxRef.current = -1
        setInput(draftRef.current)
      }
      return
    }

    if (e.key === 'Enter') send()
  }

  const handleFileSelect = e => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'))
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => setPendingImages(prev => [...prev, ev.target.result])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const refreshSuggestions = async (msgs) => {
    const ctx = investigationRef.current
    if (!ctx?.rawContext) return
    setSuggesting(true)
    try {
      const res = await fetch('/api/suggest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          incidentContext: ctx.rawContext,
          messages: msgs.map(m => ({
            role:       m.role,
            text:       m.text,
            agent:      m.agent,
            agentLabel: m.agentLabel,
          })),
        }),
      })
      const data = await res.json()
      if (Array.isArray(data?.prompts)) setSuggestedPrompts(data.prompts)
    } catch {
      // silent — chips just don't refresh
    } finally {
      setSuggesting(false)
    }
  }

  const sendText = async (rawText, imagesArg) => {
    const text = (rawText ?? '').trim()
    const imgs = imagesArg ?? (pendingImages.length ? [...pendingImages] : undefined)
    if ((!text && !imgs?.length) || loading) return

    // Handle slash commands submitted via Enter without picker
    if (text.startsWith('/')) {
      const match = COMMANDS.find(c => `/${c.cmd}` === text.split(' ')[0])
      if (match) { executeCommand(match); return }
    }

    setShowCmds(false)
    if (text) historyRef.current = [...historyRef.current, text]
    histIdxRef.current = -1
    draftRef.current   = ''

    const userMsg = { role: 'user', text: text || '(image attached)', images: imgs }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setPendingImages([])
    setSuggestedPrompts([])
    setLoading(true)

    try {
      const ctx           = investigationRef.current
      const contextPrefix = ctx?.rawContext
        ? `[Incident #${ctx.number} context — silent, do not echo back to the user:\n${ctx.rawContext}\n]\n\n`
        : ''
      const apiMessages = updated.map((m, idx) => ({
        role: m.role,
        text: (m.role === 'user' && idx === updated.length - 1)
          ? contextPrefix + (m.text || '(image attached)')
          : m.text,
        ...(m.images ? { images: m.images } : {}),
      }))
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: apiMessages }),
      })
      const data = await res.json()
      const aiMsg = {
        role:       'ai',
        agent:      data.agent      ?? 'blueagent',
        agentLabel: data.agentLabel,
        iterations: data.iterations,
        agents:     data.agents,
        text:       data.error ? `ERROR: ${data.error}` : data.reply,
      }
      const withAi = [...updated, aiMsg]
      setMessages(withAi)
      if (!data.error) refreshSuggestions(withAi)
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'ERROR: Failed to reach API server.' }])
    } finally {
      setLoading(false)
    }
  }

  const send = () => sendText(input, undefined)

  useEffect(() => { sendTextRef.current = sendText })

  return (
    <div className="chat-panel" style={{ height }}>
      <div className="chat-drag-handle" onMouseDown={onDragStart}>
        <span className="drag-dots">⠿</span>
      </div>
      <div className="chat-header">
        <span className="chat-title">
          <span className="status-dot" />
          AI Assistant
        </span>
        <button className="chat-toggle" onClick={toggle}>{expanded ? '▼' : '▲'}</button>
      </div>

      {expanded && (
        <>
          <div className="chat-messages">
            {messages.map((msg, i) => {
              const agentClass = msg.role === 'ai' ? (msg.agent ?? 'blueagent') : 'user'
              const label      = msg.role === 'user'
                ? 'YOU'
                : (msg.agentLabel ?? msg.agent ?? 'AI').toUpperCase()
              return (
                <div key={i} className={`chat-msg ${agentClass}`}>
                  <span className="msg-label">{label}</span>
                  <span className="msg-text">
                    {msg.images?.length > 0 && (
                      <span className="msg-images">
                        {msg.images.map((src, j) => (
                          <img key={j} src={src} className="msg-image" alt="" />
                        ))}
                      </span>
                    )}
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </span>
                  {msg.agents?.length > 1 && (
                    <span className="msg-meta">{msg.agents.join(' → ')}</span>
                  )}
                  {msg.iterations > 0 && (
                    <span className="msg-meta">{msg.iterations}× eval</span>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
          <div className="chat-input-row">
            <div className="chat-input-wrap">
              {showCmds && filteredCmds.length > 0 && (
                <CommandPicker
                  commands={filteredCmds}
                  activeIdx={cmdIdx}
                  onSelect={executeCommand}
                />
              )}
              {pendingImages.length > 0 && (
                <div className="chat-image-previews">
                  {pendingImages.map((src, i) => (
                    <div key={i} className="chat-image-thumb-wrap">
                      <img src={src} className="chat-image-thumb" alt="" />
                      <button
                        className="chat-image-remove"
                        onMouseDown={e => { e.preventDefault(); setPendingImages(prev => prev.filter((_, j) => j !== i)) }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <input
                className="chat-input"
                placeholder={loading ? 'Processing...' : 'Ask anything… or type / for commands'}
                value={input}
                disabled={loading}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setShowCmds(false), 100)}
                onFocus={() => input.startsWith('/') && setShowCmds(true)}
                autoComplete="off"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <button
              className="chat-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Attach image"
            >⬡</button>
            <button className="chat-send" onClick={send} disabled={loading}>
              {loading ? '...' : 'SEND'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [activeNav, setActiveNav]               = useState('Dashboard')
  const [selectedIncident, setSelectedIncident] = useState(null)
  const [suggestedPrompts, setSuggestedPrompts] = useState([])
  const [suggesting, setSuggesting]             = useState(false)
  const expandChatRef                           = useRef(null)

  const resetIncidentState = () => {
    setSuggestedPrompts([])
    setSuggesting(false)
    expandChatRef.current?.reset?.()
  }

  const handleSelectIncident = inc => {
    if (inc?.IncidentNumber !== selectedIncident?.IncidentNumber) resetIncidentState()
    setSelectedIncident(inc)
  }

  const handleCloseIncident = () => {
    resetIncidentState()
    setSelectedIncident(null)
  }

  const handleInvestigate = () => {
    expandChatRef.current?.expand?.()
    setSuggestedPrompts([])
    setSuggesting(true)
  }

  const handleInvestigationReady = ({ incidentNumber, fullContext, prompts, error }) => {
    setSuggesting(false)
    if (error || !fullContext) {
      setSuggestedPrompts([])
      return
    }
    expandChatRef.current?.applyInvestigation?.({ incidentNumber, fullContext })
    setSuggestedPrompts(Array.isArray(prompts) ? prompts : [])
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-row">
            <span className="logo-icon">◈</span>
            <span className="logo-text">BlueAgent</span>
          </div>
          <span className="logo-subtitle">Security Operations Platform</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ icon, label }) => (
            <button
              key={label}
              className={`nav-item ${activeNav === label ? 'active' : ''}`}
              onClick={() => setActiveNav(label)}
            >
              <span className="nav-icon">{icon}</span>
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="version-tag">v2.4.1</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="breadcrumb">Pages</span>
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-active">{activeNav}</span>
          </div>
          <div className="topbar-right">
            <span className="status-badge">Operational</span>
            <div className="avatar">BA</div>
          </div>
        </header>

        <div className="main-body">
          <div className="main-left">
            <main className="view-area">
              {activeNav === 'Dashboard' && <Dashboard />}
              {activeNav === 'Incidents' && (
                <Incidents
                  selected={selectedIncident}
                  onSelect={handleSelectIncident}
                />
              )}
              {activeNav === 'Analytics' && <Analytics />}
              {activeNav === 'Reports'   && <Reports />}
              {activeNav === 'Agents'    && <Agents />}
              {activeNav === 'Skills'     && <Skills />}
              {activeNav === 'Documents' && <Documents />}
              {activeNav === 'Settings'  && <Settings />}
            </main>
            <ChatPanel
              expandRef={expandChatRef}
              setSuggestedPrompts={setSuggestedPrompts}
              setSuggesting={setSuggesting}
            />
          </div>

          {activeNav === 'Incidents' && (
            <IncidentDetail
              selected={selectedIncident}
              onClose={handleCloseIncident}
              onInvestigate={handleInvestigate}
              onInvestigationReady={handleInvestigationReady}
              suggestedPrompts={suggestedPrompts}
              suggesting={suggesting}
              onPromptClick={text => expandChatRef.current?.sendPrompt?.(text)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
