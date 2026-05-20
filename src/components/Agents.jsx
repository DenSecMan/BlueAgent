import { useEffect, useState, useCallback } from 'react'

const EMPTY_AGENT = {
  name: '',
  display_name: '',
  description: '',
  system_prompt: '',
  skills: [],
  tools: [],
  model: { temperature: 0.7 },
  mission: '',
  expected: '',
  evaluator: { criteria: '', threshold: 7, max_retries: 2 },
}

function TagSelector({ label, available, selected, onChange }) {
  return (
    <div className="tag-selector">
      <div className="ag-field-label">{label}</div>
      <div className="tag-options">
        {available.map(opt => {
          const on = selected.includes(opt)
          return (
            <button
              key={opt}
              type="button"
              className={`tag-opt ${on ? 'tag-opt-on' : ''}`}
              onClick={() => onChange(on ? selected.filter(s => s !== opt) : [...selected, opt])}
            >
              {opt}
            </button>
          )
        })}
        {available.length === 0 && <span className="muted" style={{ fontSize: 12 }}>None available</span>}
      </div>
    </div>
  )
}

function AgentForm({ agent, options, onSave, onDelete, isNew }) {
  const [form, setForm] = useState(() => JSON.parse(JSON.stringify(agent)))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setForm(JSON.parse(JSON.stringify(agent)))
    setError(null)
    setConfirmDelete(false)
  }, [agent])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const setNested = (parent, key, val) =>
    setForm(f => ({ ...f, [parent]: { ...(f[parent] ?? {}), [key]: val } }))

  const save = async () => {
    if (!form.name?.trim()) return setError('Agent name is required')
    if (!form.display_name?.trim()) return setError('Display name is required')
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(isNew ? '/api/agents' : `/api/agents/${agent.name}`, {
        method:  isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      onSave(form)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      const res  = await fetch(`/api/agents/${agent.name}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Delete failed')
      onDelete(agent.name)
    } catch (e) {
      setError(e.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="ag-form">
      <div className="ag-form-cols">
        {/* ── Left column ── */}
        <div className="ag-form-body ag-form-col-border">
          {/* Identity */}
          <div className="ag-section-label">IDENTITY</div>
          <div className="ag-row-2">
            <div className="ag-field">
              <div className="ag-field-label">Name <span className="ag-required">*</span></div>
              <input
                className="ag-input"
                value={form.name ?? ''}
                readOnly={!isNew}
                placeholder="e.g. my_agent"
                style={!isNew ? { opacity: 0.6, cursor: 'default' } : {}}
                onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              />
              {isNew && <span className="ag-hint">lowercase, underscores/hyphens only</span>}
            </div>
            <div className="ag-field">
              <div className="ag-field-label">Display Name <span className="ag-required">*</span></div>
              <input
                className="ag-input"
                value={form.display_name ?? ''}
                placeholder="e.g. My Agent"
                onChange={e => set('display_name', e.target.value)}
              />
            </div>
          </div>

          <div className="ag-field">
            <div className="ag-field-label">Description</div>
            <textarea
              className="ag-input ag-textarea ag-textarea-sm"
              value={form.description ?? ''}
              placeholder="One or two sentences the orchestrator uses to decide when to route to this agent."
              onChange={e => set('description', e.target.value)}
            />
          </div>

          {/* Prompt */}
          <div className="ag-section-label">SYSTEM PROMPT</div>
          <div className="ag-field ag-field-grow">
            <textarea
              className="ag-input ag-textarea"
              value={form.system_prompt ?? ''}
              placeholder="Instructions defining this agent's role, rules, and persona."
              onChange={e => set('system_prompt', e.target.value)}
            />
          </div>

          {/* Capabilities */}
          <div className="ag-section-label">CAPABILITIES</div>
          <TagSelector
            label="Skills"
            available={options.skills}
            selected={form.skills ?? []}
            onChange={v => set('skills', v)}
          />
          <TagSelector
            label="Tools"
            available={options.tools}
            selected={form.tools ?? []}
            onChange={v => set('tools', v)}
          />

          {/* Model */}
          <div className="ag-section-label">MODEL</div>
          <div className="ag-field ag-field-narrow">
            <div className="ag-field-label">Temperature</div>
            <input
              type="number"
              className="ag-input"
              min="0" max="2" step="0.05"
              value={form.model?.temperature ?? 0.7}
              onChange={e => setNested('model', 'temperature', parseFloat(e.target.value) || 0)}
            />
            <span className="ag-hint">0 = deterministic · 2 = very creative</span>
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="ag-form-body">
          <div className="ag-section-label">EVALUATION LOOP</div>
          <div className="ag-field ag-field-grow">
            <div className="ag-field-label">Mission</div>
            <textarea
              className="ag-input ag-textarea"
              value={form.mission ?? ''}
              placeholder="What should this agent accomplish?"
              onChange={e => set('mission', e.target.value)}
            />
          </div>
          <div className="ag-field ag-field-grow">
            <div className="ag-field-label">Expected Output</div>
            <textarea
              className="ag-input ag-textarea"
              value={form.expected ?? ''}
              placeholder="What does a good response look like?"
              onChange={e => set('expected', e.target.value)}
            />
          </div>
          <div className="ag-field ag-field-grow">
            <div className="ag-field-label">Evaluator Criteria</div>
            <textarea
              className="ag-input ag-textarea"
              value={form.evaluator?.criteria ?? ''}
              placeholder="Scoring rubric used to evaluate responses (1–10 scale)."
              onChange={e => setNested('evaluator', 'criteria', e.target.value)}
            />
          </div>
          <div className="ag-row-2">
            <div className="ag-field">
              <div className="ag-field-label">Pass Threshold</div>
              <input
                type="number"
                className="ag-input"
                min="1" max="10" step="1"
                value={form.evaluator?.threshold ?? 7}
                onChange={e => setNested('evaluator', 'threshold', parseInt(e.target.value, 10) || 7)}
              />
              <span className="ag-hint">Score 1–10 required to pass</span>
            </div>
            <div className="ag-field">
              <div className="ag-field-label">Max Retries</div>
              <input
                type="number"
                className="ag-input"
                min="0" max="10" step="1"
                value={form.evaluator?.max_retries ?? 2}
                onChange={e => setNested('evaluator', 'max_retries', parseInt(e.target.value, 10) || 0)}
              />
              <span className="ag-hint">Retry attempts before giving up</span>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="ag-error">{error}</div>}

      <div className="ag-form-footer">
        {!isNew && agent.name !== 'blueagent' && (
          confirmDelete
            ? (
              <div className="ag-confirm-row">
                <span className="ag-confirm-text">Delete "{agent.display_name}"?</span>
                <button className="ag-btn ag-btn-danger" onClick={doDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button className="ag-btn ag-btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            )
            : (
              <button className="ag-btn ag-btn-ghost ag-btn-delete" onClick={() => setConfirmDelete(true)}>
                Delete Agent
              </button>
            )
        )}
        <div style={{ flex: 1 }} />
        <button className="ag-btn ag-btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create Agent' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

export default function Agents() {
  const [agents, setAgents]   = useState([])
  const [options, setOptions] = useState({ skills: [], tools: [] })
  const [selected, setSelected] = useState(null)
  const [isNew, setIsNew]     = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ar, or] = await Promise.all([
        fetch('/api/agents').then(r => r.json()),
        fetch('/api/agents/options').then(r => r.json()),
      ])
      setAgents(ar.agents ?? [])
      setOptions(or)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = updatedAgent => {
    setAgents(prev => {
      const idx = prev.findIndex(a => a.name === updatedAgent.name)
      if (idx >= 0) {
        const next = [...prev]; next[idx] = updatedAgent; return next
      }
      return [...prev, updatedAgent]
    })
    setSelected(updatedAgent)
    setIsNew(false)
  }

  const handleDelete = name => {
    setAgents(prev => prev.filter(a => a.name !== name))
    setSelected(null)
    setIsNew(false)
  }

  const startNew = () => {
    setSelected(null)
    setIsNew(true)
  }

  if (loading) return <div className="view-content"><p className="muted">Loading agents…</p></div>
  if (error)   return <div className="view-content"><p className="error-text">{error}</p></div>

  const activeAgent = isNew ? EMPTY_AGENT : selected

  return (
    <div className="ag-layout">
      {/* Left panel — agent list */}
      <div className="ag-list">
        <div className="ag-list-header">
          <span className="ag-list-title">Agents</span>
          <button className="ag-new-btn" onClick={startNew}>+ New</button>
        </div>
        <div className="ag-list-items">
          {agents.map(a => (
            <button
              key={a.name}
              className={`ag-list-item ${selected?.name === a.name && !isNew ? 'ag-list-item-active' : ''}`}
              onClick={() => { setSelected(a); setIsNew(false) }}
            >
              <div className="ag-list-name">{a.display_name || a.name}</div>
              <div className="ag-list-desc">{a.description?.replace(/\s+/g, ' ').trim().slice(0, 80)}</div>
              <div className="ag-list-meta">
                {(a.tools ?? []).length > 0 && (
                  <span className="ag-list-tag ag-list-tag-tool">{(a.tools ?? []).length} tool{(a.tools ?? []).length !== 1 ? 's' : ''}</span>
                )}
                {(a.skills ?? []).length > 0 && (
                  <span className="ag-list-tag ag-list-tag-skill">{(a.skills ?? []).length} skill{(a.skills ?? []).length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — editor */}
      <div className="ag-detail">
        {activeAgent ? (
          <>
            <div className="ag-detail-header">
              <div>
                <div className="ag-detail-title">
                  {isNew ? 'New Agent' : activeAgent.display_name || activeAgent.name}
                </div>
                {!isNew && <div className="ag-detail-sub">agents/{activeAgent.name}.yaml</div>}
              </div>
            </div>
            <AgentForm
              key={isNew ? '__new__' : activeAgent.name}
              agent={activeAgent}
              options={options}
              onSave={handleSave}
              onDelete={handleDelete}
              isNew={isNew}
            />
          </>
        ) : (
          <div className="ag-empty">
            <div className="ag-empty-icon">◈</div>
            <div className="ag-empty-text">Select an agent to edit, or create a new one.</div>
          </div>
        )}
      </div>
    </div>
  )
}
