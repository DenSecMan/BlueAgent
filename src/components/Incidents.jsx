import { useEffect, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'

const SEVERITIES = ['All', 'Critical', 'High', 'Medium', 'Low', 'Informational']
const STATUSES   = ['All', 'New', 'Active', 'Closed']

function parseOwner(raw) {
  if (!raw) return 'Unassigned'
  if (typeof raw === 'string') {
    try {
      const obj = JSON.parse(raw)
      return obj.assignedTo || obj.email || obj.objectId || 'Unassigned'
    } catch { return raw }
  }
  if (typeof raw === 'object') return raw.assignedTo || raw.email || raw.objectId || 'Unassigned'
  return String(raw)
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function parseJsonArray(val) {
  if (!val) return []
  if (Array.isArray(val)) return val
  if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

function getEntities(inc) {
  return parseJsonArray(inc.Entities ?? inc.entities)
}

function entityType(e) {
  return (e.Type ?? e.type ?? e.kind ?? 'unknown').toLowerCase()
}

function entityIcon(type) {
  if (type === 'account') return '👤'
  if (type === 'ip')      return '🌐'
  if (type === 'host')    return '🖥'
  if (type === 'file')    return '📄'
  if (type === 'url')     return '🔗'
  if (type === 'dns')     return '🔗'
  if (type === 'process') return '⚙'
  if (type === 'mailbox' || type === 'mailmessage') return '✉'
  return '◈'
}

function entityValue(e) {
  const type = entityType(e)
  if (type === 'account') {
    if (e.Name && e.UPNSuffix) return `${e.Name}@${e.UPNSuffix}`
    return e.Name || e.DisplayName || e.AadUserId || e.Sid || '—'
  }
  if (type === 'ip')   return e.Address || '—'
  if (type === 'host') return e.HostName || e.NetBiosName || e.FQDN || '—'
  if (type === 'file') return e.Name || e.Directory || '—'
  if (type === 'url')  return e.Url || '—'
  if (type === 'dns')  return e.DomainName || '—'
  return e.Address || e.HostName || e.Name || e.Url || e.DomainName || e.CommandLine || JSON.stringify(e)
}

const SEVEN_AI_AUTHOR = '7AI'

// Labels that appear with a colon suffix
const SECTION_LABELS = [
  'Conclusion', 'Agent Summary', 'Tools', 'Artifact', 'Reason', 'Recommendation',
]

// Agent names always appear immediately before one of these strings (no space)
const AGENT_SUFFIXES = ['Agent Summary', 'Artifact']

function formatSevenAI(text) {
  let out = text
    // Labels that appear WITHOUT a colon (handled before --- split)
    .replace(/\b(Key Findings|Additional Details)\b/g, '\n\n**$1**\n\n')
    // Section dividers → markdown hr
    .replace(/---/g, '\n\n---\n\n')
    // Bold and separate agent names that are directly concatenated with a label
    // e.g. "User Identity Enrichment AgentAgent Summary:" → "**User Identity Enrichment Agent**\n\nAgent Summary:"
    // e.g. "Audit Log ReviewAgent Summary:" → "**Audit Log Review**\n\nAgent Summary:"
    .replace(
      new RegExp(`([A-Z][^\\n]+?)(${AGENT_SUFFIXES.join('|')}):`, 'g'),
      (_, name, suffix) => `\n\n**${name.trim()}**\n\n${suffix}:`
    )
    // Known labelled sections → bold heading
    .replace(
      new RegExp(`\\b(${SECTION_LABELS.join('|')}):`, 'g'),
      '\n\n**$1:**\n'
    )
    // Clean up excess blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out
}

function extractDetermination(text) {
  const m = text.match(/determination:\s*(.+?)Conclusion:/i)
  return m ? m[1].trim() : null
}

function extractScore(text) {
  if (!text) return null
  const m = text.match(/agreement\s+score[^0-9]*(\d{1,3})\s*\/\s*100/i)
          || text.match(/score[^0-9]*(\d{1,3})\s*\/\s*100/i)
          || text.match(/(\d{1,3})\s*\/\s*100/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 100 ? n : null
}

function scoreClass(n) {
  if (n >= 76) return 'score-high'
  if (n >= 51) return 'score-mid'
  if (n >= 26) return 'score-low'
  return 'score-crit'
}

function determinationClass(d) {
  if (!d) return ''
  const lower = d.toLowerCase()
  if (lower.includes('malicious'))    return 'det-malicious'
  if (lower.includes('benign'))       return 'det-benign'
  if (lower.includes('inconclusive')) return 'det-inconclusive'
  return 'det-unknown'
}

function SevenAIView({ comments, loading, review }) {
  const [commentOpen, setCommentOpen] = useState(true)
  const [reviewOpen, setReviewOpen]   = useState(true)

  if (loading) {
    return <div className="context-preview"><p className="detail-description muted" style={{ marginTop: 12 }}>Loading…</p></div>
  }

  const aiComments = comments.filter(c => {
    const author = c.author?.name || c.author?.email || c.author?.objectId || ''
    return author.toLowerCase().includes(SEVEN_AI_AUTHOR.toLowerCase())
  })

  if (aiComments.length === 0) {
    return (
      <div className="context-preview">
        <p className="detail-description muted" style={{ marginTop: 12 }}>No 7AI comments found for this incident.</p>
      </div>
    )
  }

  const score = extractScore(review.text)

  return (
    <div className="context-preview">
      <div className="sevenai-review">
        <button className="sevenai-collapse-btn" onClick={() => setReviewOpen(o => !o)}>
          <div className="sevenai-review-header">
            <span className="sevenai-review-title">◈ BlueAgent Independent Review</span>
            <span className="sevenai-review-header-right">
              {review.loading && <span className="sevenai-review-loading">Analysing…</span>}
              <span className="comments-chevron">{reviewOpen ? '▲' : '▼'}</span>
            </span>
          </div>
        </button>
        {reviewOpen && (
          <>
            {review.loading && (
              <div className="sevenai-review-body muted">Running independent assessment…</div>
            )}
            {!review.loading && review.text && (
              <div className="sevenai-review-body">
                <ReactMarkdown>{review.text}</ReactMarkdown>
              </div>
            )}
            {!review.loading && !review.text && (
              <div className="sevenai-review-body muted">
                {review.error ?? 'Assessment unavailable.'}
              </div>
            )}
          </>
        )}
      </div>

      {aiComments.map((c, i) => {
        const time          = c.createdTimeUtc || c.lastModifiedTimeUtc || ''
        const msg           = c.message || c.body || ''
        const determination = extractDetermination(msg)
        return (
          <div key={i} className="sevenai-comment">
            <button className="sevenai-collapse-btn" onClick={() => setCommentOpen(o => !o)}>
              <div className="sevenai-meta">
                {time && <span className="sevenai-date">{formatDate(time)}</span>}
                {review.loading && <span className="sevenai-score-pending">Agreement score: —</span>}
                {!review.loading && score !== null && (
                  <span className={`sevenai-score ${scoreClass(score)}`}>Agreement score: {score}/100</span>
                )}
                {determination && (
                  <span className={`sevenai-determination ${determinationClass(determination)}`}>
                    7AI Determination: {determination}
                  </span>
                )}
                <span className="comments-chevron">{commentOpen ? '▲' : '▼'}</span>
              </div>
            </button>
            {commentOpen && (
              <div className="sevenai-body">
                <ReactMarkdown>{formatSevenAI(msg)}</ReactMarkdown>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function scoreKey(type, value) {
  return `${String(type).toLowerCase()}|${String(value).toLowerCase()}`
}

function scoreBand(score) {
  if (score >= 76) return 'malicious'
  if (score >= 51) return 'likely-malicious'
  if (score >= 26) return 'suspicious'
  return 'benign'
}

function entityScoreKey(e) {
  const t = entityType(e)
  if (t === 'ip')                  return scoreKey('ip',     e.Address ?? e.address ?? '')
  if (t === 'dns')                 return scoreKey('domain', e.DomainName ?? e.domainName ?? '')
  if (t === 'url')                 return scoreKey('url',    e.Url ?? e.url ?? '')
  if (t === 'filehash')            return scoreKey('hash',   e.Value ?? e.value ?? '')
  return null
}

function buildContext(inc, owner, desc, labels, entities, comments, alerts = [], entityScores = []) {
  const lines = []
  lines.push(`INCIDENT #${inc.IncidentNumber}: ${inc.Title}`)
  lines.push(`Severity : ${inc.Severity ?? '—'}`)
  lines.push(`Status   : ${inc.Status ?? '—'}`)
  lines.push(`Owner    : ${owner}`)
  lines.push(`Created  : ${formatDate(inc.CreatedTime)}`)
  lines.push(`Modified : ${formatDate(inc.LastModifiedTime)}`)
  if (desc) {
    lines.push('')
    lines.push('── DESCRIPTION ──────────────────────────────')
    lines.push(desc)
  }

  if (labels.length > 0) {
    lines.push('')
    lines.push('── LABELS ───────────────────────────────────')
    lines.push(labels.map(l => typeof l === 'string' ? l : l.labelName ?? JSON.stringify(l)).join(', '))
  }

  if (alerts.length > 0) {
    lines.push('')
    lines.push('── ALERTS ───────────────────────────────────')
    alerts.forEach(a => {
      lines.push(`[${a.AlertSeverity ?? '—'}] ${a.AlertName ?? '(unnamed)'} — ${a.ProviderName ?? a.VendorName ?? '—'}`)
      if (a.Description) lines.push(`  Description: ${String(a.Description).slice(0, 600)}`)
      if (a.Tactics)     lines.push(`  Tactics:    ${a.Tactics}`)
      if (a.Techniques)  lines.push(`  Techniques: ${a.Techniques}`)
      if (a.StartTime)   lines.push(`  Start:      ${formatDate(a.StartTime)}`)
      if (a.EndTime)     lines.push(`  End:        ${formatDate(a.EndTime)}`)
    })
  }

  const scoreByKey = new Map(entityScores.map(s => [scoreKey(s.type, s.value), s]))
  const seen = new Set()
  const knownEntities = entities.filter(e => {
    if (entityType(e) === 'unknown') return false
    const key = `${entityType(e)}:${entityValue(e)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (knownEntities.length > 0) {
    lines.push('')
    lines.push('── ENTITIES ─────────────────────────────────')
    knownEntities.forEach(e => {
      const type  = entityType(e)
      const value = entityValue(e)
      const k     = entityScoreKey(e)
      const s     = k ? scoreByKey.get(k) : null
      const tag   = s ? ` — ${s.score}/100 ${s.classification}` : ''
      lines.push(`[${type.toUpperCase()}] ${value}${tag}`)
      if (s?.summary) lines.push(`  ↳ ${s.summary}`)
    })
  }

  const sevenAIComments = comments.filter(c => {
    const author = c.author?.name || c.author?.email || c.author?.objectId || ''
    return author.toLowerCase().includes(SEVEN_AI_AUTHOR.toLowerCase())
  })
  if (sevenAIComments.length > 0) {
    lines.push('')
    lines.push('── 7AI COMMENTS ─────────────────────────────')
    sevenAIComments.forEach((c, i) => {
      const time = c.createdTimeUtc || c.lastModifiedTimeUtc || ''
      const msg  = String(c.message || c.body || '').slice(0, 4000)
      lines.push(`[${i + 1}] ${time ? formatDate(time) : '—'}`)
      lines.push(msg)
    })
  }

  return lines.join('\n')
}

function ContextView({ rawContext }) {
  const [rawOpen, setRawOpen] = useState(true)

  return (
    <div className="context-preview">
      <div className="threat-review">
        <button className="sevenai-collapse-btn" onClick={() => setRawOpen(o => !o)}>
          <div className="threat-review-header">
            <span className="threat-review-title" style={{ color: 'var(--text-dim)' }}>◫ Raw Incident Context</span>
            <span className="comments-chevron">{rawOpen ? '▲' : '▼'}</span>
          </div>
        </button>
        {rawOpen && (
          <pre className="context-pre" style={{ margin: '8px 14px 10px' }}>{rawContext}</pre>
        )}
      </div>
    </div>
  )
}

export function IncidentDetail({ selected, onClose, onInvestigate, onInvestigationReady, suggestedPrompts = [], suggesting = false, onPromptClick }) {
  const [entities, setEntities]               = useState([])
  const [entitiesLoading, setEntitiesLoading] = useState(false)
  const [alerts, setAlerts]                   = useState([])
  const [comments, setComments]               = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsOpen, setCommentsOpen]       = useState(true)
  const [entitiesOpen, setEntitiesOpen]       = useState(true)
  const [view, setView]                       = useState(null) // null | 'context' | '7ai'
  const [sevenAIReview, setSevenAIReview]     = useState({ loading: false, text: null })
  const [entityScores, setEntityScores]       = useState([])
  const [investigating, setInvestigating]     = useState(false)
  const prevNumRef              = useRef(null)
  const reviewTriggeredRef      = useRef(false)
  const rawContextRef           = useRef('')
  const viewRef                 = useRef(null)

  useEffect(() => {
    if (!selected) { setEntities([]); setComments([]); setAlerts([]); setEntityScores([]); return }
    if (selected.IncidentNumber === prevNumRef.current) return
    prevNumRef.current = selected.IncidentNumber
    viewRef.current = null
    setView(null)
    setSevenAIReview({ loading: false, text: null })
    reviewTriggeredRef.current = false
    setEntityScores([])
    setInvestigating(false)

    setEntities([])
    setEntitiesLoading(true)
    fetch(`/api/incidents/${selected.IncidentNumber}/entities`)
      .then(r => r.json())
      .then(d => setEntities(Array.isArray(d.entities) ? d.entities : []))
      .catch(() => setEntities([]))
      .finally(() => setEntitiesLoading(false))

    setAlerts([])
    fetch(`/api/incidents/${selected.IncidentNumber}/alerts`)
      .then(r => r.json())
      .then(d => setAlerts(Array.isArray(d.alerts) ? d.alerts : []))
      .catch(() => setAlerts([]))

    setComments([])
    setCommentsLoading(true)
    fetch(`/api/incidents/${selected.IncidentNumber}/comments`)
      .then(r => r.json())
      .then(d => setComments(Array.isArray(d.comments) ? d.comments : []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false))
  }, [selected])

  useEffect(() => {
    if (view !== '7ai' || commentsLoading || reviewTriggeredRef.current) return
    const aiComment = comments.find(c => {
      const author = c.author?.name || c.author?.email || c.author?.objectId || ''
      return author.toLowerCase().includes(SEVEN_AI_AUTHOR.toLowerCase())
    })
    if (!aiComment) return

    reviewTriggeredRef.current = true
    setSevenAIReview({ loading: true, text: null })
    const msg = aiComment.message || aiComment.body || ''
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          text: `Review this 7AI investigation report. Provide a score from 1–100 indicating how much you agree with 7AI's determination, and a single concise paragraph explaining your reasoning.\n\n${msg}`,
        }],
      }),
    })
      .then(r => r.json())
      .then(d => setSevenAIReview({ loading: false, text: d.error ? null : d.reply, error: d.error ?? null }))
      .catch(() => setSevenAIReview({ loading: false, text: null, error: 'Could not reach the API server.' }))
  }, [view, commentsLoading, comments])

  if (!selected) {
    return (
      <div className="incident-detail">
        <div className="detail-empty">
          <span className="detail-empty-icon">◈</span>
          <span className="detail-empty-text">Select an incident<br />to view details</span>
        </div>
      </div>
    )
  }

  const labels = parseJsonArray(selected.Labels ?? selected.labels)
  const desc   = (typeof selected.Description === 'string' ? selected.Description : '') || ''
  const owner  = parseOwner(selected.Owner)
  rawContextRef.current = buildContext(selected, owner, desc, labels, entities, comments, alerts, entityScores)

  const runInvestigation = async () => {
    if (investigating) return
    const num = selected.IncidentNumber
    onInvestigate?.()
    setInvestigating(true)
    try {
      const initialContext = buildContext(selected, owner, desc, labels, entities, comments, alerts, [])
      const res  = await fetch(`/api/investigate/${num}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ incidentContext: initialContext }),
      })
      const data = await res.json()
      if (data.error) {
        onInvestigationReady?.({ error: data.error })
        return
      }
      const scores = Array.isArray(data.entityScores) ? data.entityScores : []
      setEntityScores(scores)
      const fullContext = buildContext(selected, owner, desc, labels, entities, comments, alerts, scores)
      onInvestigationReady?.({
        incidentNumber: num,
        fullContext,
        prompts:    Array.isArray(data.prompts) ? data.prompts : [],
        threatIntel: data.threatIntel ?? null,
      })
    } catch (err) {
      onInvestigationReady?.({ error: err.message || 'Investigation failed' })
    } finally {
      setInvestigating(false)
    }
  }

  return (
    <div className="incident-detail">
      <div className="detail-header">
        <span className="mono muted">INCIDENT #{selected.IncidentNumber}</span>
        <button className="detail-close" onClick={onClose}>✕</button>
      </div>

      <h2 className="detail-title">{selected.Title}</h2>

      <div className="detail-badges">
        <span className={`badge sev-${selected.Severity?.toLowerCase()}`}>{selected.Severity}</span>
        <span className={`badge status-${selected.Status?.toLowerCase().replace(/\s+/g, '-')}`}>{selected.Status}</span>
      </div>

      <div className="detail-btn-row">
        <button
          className="investigate-btn"
          onClick={runInvestigation}
          disabled={investigating || entitiesLoading || commentsLoading}
        >
          {investigating ? '◈ ANALYSING…' : '◈ AI INVESTIGATION'}
        </button>
        <button
          className={`context-btn${view === '7ai' ? ' context-btn-active' : ''}`}
          onClick={() => { const next = view === '7ai' ? null : '7ai'; viewRef.current = next; setView(next) }}
        >
          ◫ 7AI
        </button>
        <button
          className={`context-btn${view === 'context' ? ' context-btn-active' : ''}`}
          onClick={() => { const next = view === 'context' ? null : 'context'; viewRef.current = next; setView(next) }}
        >
          ◫ CONTEXT
        </button>
      </div>

      {view === 'context' ? (
        <ContextView rawContext={rawContextRef.current} />
      ) : view === '7ai' ? (
        <SevenAIView comments={comments} loading={commentsLoading} review={sevenAIReview} />
      ) : (
        <>
          <div className="detail-section">
            <div className="detail-section-label">Details</div>
            <div className="detail-meta">
              <div className="meta-row">
                <span className="meta-label">Created</span>
                <span className="meta-val">{formatDate(selected.CreatedTime)}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Last Modified</span>
                <span className="meta-val">{formatDate(selected.LastModifiedTime)}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Owner</span>
                <span className="meta-val">{owner}</span>
              </div>
            </div>
          </div>

          {desc && (
            <div className="detail-section">
              <div className="detail-section-label">Description</div>
              <p className="detail-description">{desc}</p>
            </div>
          )}

          {labels.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-label">Labels</div>
              <div className="detail-labels">
                {labels.map((l, i) => (
                  <span key={i} className="detail-label-tag">{typeof l === 'string' ? l : l.labelName ?? JSON.stringify(l)}</span>
                ))}
              </div>
            </div>
          )}

          <div className="detail-section">
            <button
              className="comments-toggle"
              onClick={() => setEntitiesOpen(o => !o)}
            >
              <span className="detail-section-label" style={{ margin: 0 }}>
                {entitiesLoading ? 'Entities (loading…)' : `Entities (${entities.length})`}
              </span>
              <span className="comments-chevron">{entitiesOpen ? '▲' : '▼'}</span>
            </button>

            {entitiesOpen && (
              <div className="detail-entities" style={{ marginTop: 10 }}>
                {!entitiesLoading && entities.length === 0 && (
                  <p className="detail-description muted">No entities found.</p>
                )}
                {(() => {
                  const known   = entities.filter(e => entityType(e) !== 'unknown')
                  const unknownCount = entities.length - known.length
                  const scoreByKey  = new Map(entityScores.map(s => [scoreKey(s.type, s.value), s]))
                  return (
                    <>
                      {unknownCount > 0 && (
                        <div className="entity-row">
                          <span className="entity-icon">◈</span>
                          <div className="entity-body">
                            <span className="entity-type">UNKNOWN</span>
                            <span className="entity-value muted">{unknownCount} unclassified {unknownCount === 1 ? 'entity' : 'entities'}</span>
                          </div>
                        </div>
                      )}
                      {known.slice(0, 10).map((e, i) => {
                        const type = entityType(e)
                        const k    = entityScoreKey(e)
                        const s    = k ? scoreByKey.get(k) : null
                        const cls  = s ? `score-${scoreBand(s.score)}` : ''
                        return (
                          <div key={i} className="entity-row" title={s?.summary || ''}>
                            <span className="entity-icon">{entityIcon(type)}</span>
                            <div className="entity-body">
                              <span className="entity-type">{type.toUpperCase()}</span>
                              <span className="entity-value">{entityValue(e)}</span>
                            </div>
                            {s && (
                              <span className={`entity-score-badge ${cls}`}>
                                <span className="entity-score-num">{s.score}</span>
                                <span className="entity-score-label">{s.classification}</span>
                              </span>
                            )}
                            {!s && investigating && k && (
                              <span className="entity-score-badge score-pending">…</span>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          <div className="detail-section">
            <button
              className="comments-toggle"
              onClick={() => setCommentsOpen(o => !o)}
            >
              <span className="detail-section-label" style={{ margin: 0 }}>
                {commentsLoading ? 'Comments (loading…)' : `Comments (${comments.length})`}
              </span>
              <span className="comments-chevron">{commentsOpen ? '▲' : '▼'}</span>
            </button>

            {commentsOpen && (
              <div className="comments-list">
                {!commentsLoading && comments.length === 0 && (
                  <p className="detail-description muted">No comments.</p>
                )}
                {comments.map((c, i) => {
                  const author = c.author?.name || c.author?.email || c.author?.objectId || 'Unknown'
                  const time   = c.createdTimeUtc || c.lastModifiedTimeUtc || ''
                  const msg    = c.message || c.body || ''
                  return (
                    <div key={i} className="comment-item">
                      <div className="comment-header">
                        <span className="comment-author">{author}</span>
                        {time && <span className="comment-time">{formatDate(time)}</span>}
                      </div>
                      <p className="comment-body">{msg}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {selected.IncidentUrl && (
            <div className="detail-section">
              <a
                className="portal-link"
                href={selected.IncidentUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                ↗ Open in Azure Portal
              </a>
            </div>
          )}

          {(suggestedPrompts.length > 0 || suggesting) && (
            <div className="detail-section">
              <div className="detail-section-label">{suggesting ? 'Suggested (refreshing…)' : 'Suggested Prompts'}</div>
              <div className="detail-suggested">
                {suggestedPrompts.map((p, i) => (
                  <button
                    key={i}
                    className="chip chip-block"
                    title={p}
                    onClick={() => onPromptClick?.(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Incidents({ selected, onSelect }) {
  const [incidents, setIncidents] = useState([])
  const [search, setSearch]       = useState('')
  const [severity, setSeverity]   = useState('All')
  const [status, setStatus]       = useState('All')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  useEffect(() => {
    fetch('/api/incidents?period=PT24H')
      .then(r => r.json())
      .then(d => { setIncidents(d.incidents ?? []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const filtered = incidents.filter(inc => {
    const q = search.toLowerCase()
    const matchSearch   = !q || inc.Title?.toLowerCase().includes(q) || String(inc.IncidentNumber).includes(q)
    const matchSeverity = severity === 'All' || inc.Severity === severity
    const matchStatus   = status   === 'All' || inc.Status   === status
    return matchSearch && matchSeverity && matchStatus
  })

  return (
    <div className="incidents-list">
      <div className="incidents-toolbar">
        <input
          className="search-input"
          placeholder="Search incidents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-select" value={severity} onChange={e => setSeverity(e.target.value)}>
          {SEVERITIES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={status} onChange={e => setStatus(e.target.value)}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <span className="count-label">{filtered.length} incidents</span>
      </div>

      {loading && <p className="panel-empty muted">Loading...</p>}
      {error   && <p className="panel-empty error-text">{error}</p>}

      {!loading && !error && (
        <div className="table-wrap table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Title</th><th>Alerts</th><th>Severity</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {filtered.map(inc => (
                <tr
                  key={inc.IncidentNumber}
                  className={selected?.IncidentNumber === inc.IncidentNumber ? 'row-selected' : ''}
                  onClick={() => onSelect(inc)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="mono muted">#{inc.IncidentNumber}</td>
                  <td>{inc.Title}</td>
                  <td className="mono muted">{parseJsonArray(inc.AlertIds ?? inc.alertIds).length}</td>
                  <td><span className={`badge sev-${inc.Severity?.toLowerCase()}`}>{inc.Severity}</span></td>
                  <td><span className={`badge status-${inc.Status?.toLowerCase().replace(/\s+/g, '-')}`}>{inc.Status}</span></td>
                  <td className="mono muted">{formatDate(inc.CreatedTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
