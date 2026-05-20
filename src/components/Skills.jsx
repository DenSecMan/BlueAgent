import { useEffect, useState, useCallback, useMemo } from 'react'

const EMPTY_SKILL = { name: '', content: '' }

// ── Agent assignment toggles ─────────────────────────────────────────────────

function AgentAssignment({ skillName, agents, onAgentsChange }) {
  const [toggling, setToggling] = useState(null)
  const [error, setError]       = useState(null)

  const toggle = async (agent) => {
    const hasSkill  = (agent.skills ?? []).includes(skillName)
    const newSkills = hasSkill
      ? (agent.skills ?? []).filter(s => s !== skillName)
      : [...(agent.skills ?? []), skillName]

    setToggling(agent.name)
    setError(null)
    try {
      const res = await fetch(`/api/agents/${agent.name}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...agent, skills: newSkills }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Update failed')
      onAgentsChange(agents.map(a => a.name === agent.name ? { ...a, skills: newSkills } : a))
    } catch (e) {
      setError(e.message)
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="tag-selector">
      <div className="tag-options">
        {agents.length === 0
          ? <span className="muted" style={{ fontSize: 12 }}>No agents available</span>
          : agents.map(agent => {
              const on   = (agent.skills ?? []).includes(skillName)
              const busy = toggling === agent.name
              return (
                <button
                  key={agent.name}
                  type="button"
                  className={`tag-opt ${on ? 'tag-opt-on' : ''}`}
                  onClick={() => toggle(agent)}
                  disabled={busy}
                >
                  {busy ? '…' : (agent.display_name || agent.name)}
                </button>
              )
            })
        }
      </div>
      {error && <div className="ag-error" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  )
}

// ── Security badge ───────────────────────────────────────────────────────────

function ConfidenceBadge({ score, verdict }) {
  const color = score <= 30 ? '#22c55e' : score <= 60 ? '#f59e0b' : '#ef4444'
  const label = score <= 30 ? 'LOW RISK' : score <= 60 ? 'SUSPICIOUS' : 'HIGH RISK'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: `${color}22`, border: `1px solid ${color}55`,
        borderRadius: 8, padding: '8px 16px', minWidth: 80,
      }}>
        <span style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 10, color, letterSpacing: 1, marginTop: 2 }}>{label}</span>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 2 }}>VERDICT</div>
        <div style={{
          fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1,
          color: verdict === 'safe' ? '#22c55e' : verdict === 'suspicious' ? '#f59e0b' : '#ef4444',
        }}>
          {verdict}
        </div>
      </div>
    </div>
  )
}

// ── File tree ────────────────────────────────────────────────────────────────

function buildTree(files) {
  const root = {}
  for (const f of files) {
    const parts = f.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (node[parts[i]] === null || node[parts[i]] === undefined) node[parts[i]] = {}
      node = node[parts[i]]
    }
    const leaf = parts[parts.length - 1]
    if (!(leaf in node)) node[leaf] = null
  }
  return root
}

const FILE_ICONS = { md: '◻', json: '{}', kql: 'KQ', py: 'Py', js: 'JS', yaml: 'YM', yml: 'YM' }

function TreeNode({ name, node, depth, filePath, selected, onSelect }) {
  const isDir = node !== null && typeof node === 'object'
  const [open, setOpen] = useState(true)
  const ext  = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  const icon = FILE_ICONS[ext] ?? '◻'

  if (isDir) {
    return (
      <div>
        <button
          className="skill-tree-dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setOpen(o => !o)}
        >
          <span className="skill-tree-arrow">{open ? '▾' : '▸'}</span>
          <span className="skill-tree-name">{name}</span>
        </button>
        {open && Object.entries(node).map(([k, v]) => (
          <TreeNode
            key={k}
            name={k}
            node={v}
            depth={depth + 1}
            filePath={filePath ? `${filePath}/${k}` : k}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    )
  }

  return (
    <button
      className={`skill-tree-file ${selected === filePath ? 'skill-tree-file-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(filePath)}
    >
      <span className="skill-tree-icon">{icon}</span>
      <span className="skill-tree-name">{name}</span>
    </button>
  )
}

function FileTree({ files, selected, onSelect }) {
  const tree = useMemo(() => buildTree(files), [files])
  return (
    <div className="skill-file-panel">
      <div className="skill-file-panel-header">FILES</div>
      <div className="skill-tree-body">
        {Object.entries(tree).map(([k, v]) => (
          <TreeNode
            key={k}
            name={k}
            node={v}
            depth={0}
            filePath={k}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

// ── Install form ─────────────────────────────────────────────────────────────

function InstallForm({ onInstalled, onCancel }) {
  const [url, setUrl]               = useState('')
  const [fetching, setFetching]     = useState(false)
  const [fetchErr, setFetchErr]     = useState(null)
  const [preview, setPreview]       = useState(null)
  const [name, setName]             = useState('')
  const [analysis, setAnalysis]     = useState(null)
  const [analyzing, setAnalyzing]   = useState(false)
  const [analyzeErr, setAnalyzeErr] = useState(null)
  const [installing, setInstalling] = useState(false)
  const [installErr, setInstallErr] = useState(null)

  const safeJson = async (res) => {
    const text = await res.text()
    try { return { ok: res.ok, data: JSON.parse(text) } }
    catch { return { ok: false, data: { error: res.ok ? 'Unexpected server response — is the API server running?' : `Server error (${res.status})` } } }
  }

  const fetchSkill = async () => {
    if (!url.trim()) return
    setFetching(true)
    setFetchErr(null)
    setPreview(null)
    setAnalysis(null)
    setAnalyzeErr(null)
    try {
      const res           = await fetch('/api/skills/fetch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      })
      const { ok, data } = await safeJson(res)
      if (!ok) throw new Error(data.error ?? 'Fetch failed')
      setPreview(data)
      setName(data.suggestedName)
      analyzeSkill(data.suggestedName, data.content)
    } catch (e) {
      setFetchErr(e.message)
    } finally {
      setFetching(false)
    }
  }

  const analyzeSkill = async (skillName, content) => {
    setAnalyzing(true)
    setAnalyzeErr(null)
    try {
      const res           = await fetch('/api/skills/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: skillName, content }),
      })
      const { ok, data } = await safeJson(res)
      if (!ok) throw new Error(data.error ?? 'Analysis failed')
      setAnalysis(data)
    } catch (e) {
      setAnalyzeErr(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const install = async () => {
    if (!name.trim()) return setInstallErr('Skill name is required')
    setInstalling(true)
    setInstallErr(null)
    try {
      const body = preview.files
        ? { name, content: preview.content, files: preview.files }
        : { name, content: preview.content }
      const res           = await fetch('/api/skills', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const { ok, data } = await safeJson(res)
      if (!ok) throw new Error(data.error ?? 'Install failed')
      onInstalled({ name, content: preview.content, path: `skills/${name}/SKILL.md` })
    } catch (e) {
      setInstallErr(e.message)
    } finally {
      setInstalling(false)
    }
  }

  const canInstall = preview && !analyzing && !fetching

  return (
    <div className="ag-form">
      <div className="ag-form-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

        <div className="ag-section-label">SOURCE URL</div>
        <div className="ag-field">
          <div className="ag-field-label">URL</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="ag-input"
              style={{ flex: 1 }}
              value={url}
              placeholder="skills.sh URL · GitHub /tree/ or /blob/ URL · npx skills add <repo> --skill <name>"
              onChange={e => { setUrl(e.target.value); setPreview(null); setAnalysis(null); setFetchErr(null) }}
              onKeyDown={e => e.key === 'Enter' && fetchSkill()}
              disabled={fetching || analyzing}
            />
            <button
              className="ag-btn ag-btn-primary"
              onClick={fetchSkill}
              disabled={fetching || analyzing || !url.trim()}
              style={{ whiteSpace: 'nowrap' }}
            >
              {fetching ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          <span className="ag-hint">Accepts: skills.sh page URL · GitHub /tree/ directory · GitHub /blob/ file · <code>npx skills add &lt;repo&gt; --skill &lt;name&gt;</code> install command</span>
          {fetchErr && <div className="ag-error" style={{ marginTop: 6 }}>{fetchErr}</div>}
        </div>

        {preview && (
          <>
            <div className="ag-section-label">SKILL NAME</div>
            <div className="ag-field">
              <div className="ag-field-label">Name <span className="ag-required">*</span></div>
              <input
                className="ag-input"
                value={name}
                placeholder="e.g. web_research"
                onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              />
              <span className="ag-hint">lowercase, underscores/hyphens only · saved as skills/{name || '{name}'}/SKILL.md</span>
            </div>

            {preview.files && (
              <>
                <div className="ag-section-label">
                  FILES TO INSTALL
                  <span className="ag-hint" style={{ marginLeft: 8 }}>{Object.keys(preview.files).length} file{Object.keys(preview.files).length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{
                  background: 'var(--surface-2, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border)',
                  borderRadius: 6, padding: '8px 12px', marginBottom: 8,
                  maxHeight: 120, overflowY: 'auto',
                }}>
                  {Object.keys(preview.files).map(f => (
                    <div key={f} style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-dim)', padding: '2px 0' }}>
                      skills/{name || '{name}'}/{f}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="ag-section-label">
              SECURITY ANALYSIS
              {analyzing && <span className="ag-hint" style={{ marginLeft: 8 }}>Analysing with skill_analyzer agent…</span>}
            </div>

            {analyzeErr && <div className="ag-error" style={{ marginBottom: 8 }}>{analyzeErr}</div>}

            {analyzing && (
              <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '12px 0' }}>
                Running security analysis…
              </div>
            )}

            {analysis && (
              <div style={{ marginBottom: 12 }}>
                <ConfidenceBadge score={analysis.confidence} verdict={analysis.verdict} />
                {analysis.findings.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div className="ag-field-label" style={{ marginBottom: 4 }}>Findings</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-dim)' }}>
                      {analysis.findings.map((f, i) => <li key={i} style={{ marginBottom: 4 }}>{f}</li>)}
                    </ul>
                  </div>
                )}
                <div className="ag-field-label" style={{ marginBottom: 4 }}>Report</div>
                <div style={{
                  fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)',
                  background: 'var(--surface-2, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border)',
                  borderRadius: 6, padding: '10px 14px',
                  whiteSpace: 'pre-wrap',
                }}>
                  {analysis.report}
                </div>
                {analysis.confidence > 60 && (
                  <div style={{
                    marginTop: 10, padding: '8px 12px', borderRadius: 6,
                    background: '#ef444420', border: '1px solid #ef444455',
                    color: '#ef4444', fontSize: 13,
                  }}>
                    High risk score detected. Review the findings carefully before installing.
                  </div>
                )}
              </div>
            )}

            <div className="ag-section-label">CONTENT PREVIEW</div>
            <div className="ag-field ag-field-grow">
              <textarea
                className="ag-input ag-textarea"
                value={preview.content}
                readOnly
                style={{ opacity: 0.75, cursor: 'default' }}
              />
            </div>
          </>
        )}
      </div>

      {installErr && <div className="ag-error">{installErr}</div>}

      <div className="ag-form-footer">
        <button className="ag-btn ag-btn-ghost" onClick={onCancel}>Cancel</button>
        <div style={{ flex: 1 }} />
        <button
          className="ag-btn ag-btn-primary"
          onClick={install}
          disabled={!canInstall || installing}
        >
          {installing ? 'Installing…' : 'Install Skill'}
        </button>
      </div>
    </div>
  )
}

// ── Skill edit form ──────────────────────────────────────────────────────────

function SkillForm({ skill, agents, onAgentsChange, onSave, onDelete, isNew }) {
  const [name, setName]                   = useState(skill.name ?? '')
  const [activeFile, setActiveFile]       = useState('SKILL.md')
  const [fileContent, setFileContent]     = useState(skill.content ?? '')
  const [loadingFile, setLoadingFile]     = useState(false)
  const [saving, setSaving]               = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError]                 = useState(null)

  const hasFiles = (skill.files?.length ?? 0) > 0

  useEffect(() => {
    setName(skill.name ?? '')
    setActiveFile('SKILL.md')
    setFileContent(skill.content ?? '')
    setError(null)
    setConfirmDelete(false)
  }, [skill])

  const selectFile = async (filePath) => {
    if (filePath === activeFile) return
    setActiveFile(filePath)
    if (filePath === 'SKILL.md') {
      setFileContent(skill.content ?? '')
      return
    }
    setLoadingFile(true)
    setError(null)
    try {
      const res  = await fetch(`/api/skills/${skill.name}/file?path=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load file')
      setFileContent(data.content)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingFile(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        if (!name.trim()) throw new Error('Skill name is required')
        const res  = await fetch('/api/skills', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name, content: fileContent }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Save failed')
        onSave({ name, content: fileContent, path: `skills/${name}/SKILL.md` })
      } else if (activeFile === 'SKILL.md') {
        const res  = await fetch(`/api/skills/${skill.name}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ content: fileContent }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Save failed')
        onSave({ ...skill, content: fileContent })
      } else {
        const res  = await fetch(`/api/skills/${skill.name}/file?path=${encodeURIComponent(activeFile)}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ content: fileContent }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Save failed')
      }
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
      const res  = await fetch(`/api/skills/${skill.name}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Delete failed')
      onDelete(skill.name)
    } catch (e) {
      setError(e.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const contentLabel = activeFile === 'SKILL.md'
    ? 'CONTENT'
    : `CONTENT — ${activeFile}`

  const saveLabel = saving
    ? 'Saving…'
    : isNew
      ? 'Create Skill'
      : activeFile === 'SKILL.md' ? 'Save Changes' : 'Save File'

  return (
    <div className="ag-form">
      <div className="ag-form-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top sections — scroll if needed */}
        <div style={{ flexShrink: 0, overflowY: 'auto' }}>
          <div className="ag-section-label">IDENTITY</div>
          <div className="ag-field">
            <div className="ag-field-label">Name <span className="ag-required">*</span></div>
            <input
              className="ag-input"
              value={name}
              readOnly={!isNew}
              placeholder="e.g. web_research"
              style={!isNew ? { opacity: 0.6, cursor: 'default' } : {}}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            />
            {isNew
              ? <span className="ag-hint">lowercase, underscores/hyphens only · saved as skills/{'{name}'}/SKILL.md</span>
              : <span className="ag-hint">{skill.path ?? `skills/${skill.name}/SKILL.md`}</span>
            }
          </div>

          {!isNew && (
            <>
              <div className="ag-section-label">ASSIGNED TO</div>
              <AgentAssignment
                skillName={skill.name}
                agents={agents}
                onAgentsChange={onAgentsChange}
              />
            </>
          )}
        </div>

        {/* Bottom: file tree + editor */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {hasFiles && !isNew && (
            <FileTree
              files={skill.files}
              selected={activeFile}
              onSelect={selectFile}
            />
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <div className="ag-section-label" style={{ flexShrink: 0 }}>{contentLabel}</div>
            <div className="ag-field ag-field-grow" style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column' }}>
              <textarea
                className="ag-input ag-textarea"
                value={loadingFile ? 'Loading…' : fileContent}
                readOnly={loadingFile}
                placeholder="Markdown instructions appended to the agent's system prompt when this skill is enabled."
                onChange={e => setFileContent(e.target.value)}
                style={loadingFile ? { opacity: 0.5, cursor: 'default' } : {}}
              />
            </div>
          </div>
        </div>
      </div>

      {error && <div className="ag-error">{error}</div>}

      <div className="ag-form-footer">
        {!isNew && (
          confirmDelete
            ? (
              <div className="ag-confirm-row">
                <span className="ag-confirm-text">Delete "{skill.name}"?</span>
                <button className="ag-btn ag-btn-danger" onClick={doDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button className="ag-btn ag-btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            )
            : (
              <button className="ag-btn ag-btn-ghost ag-btn-delete" onClick={() => setConfirmDelete(true)}>
                Delete Skill
              </button>
            )
        )}
        <div style={{ flex: 1 }} />
        <button className="ag-btn ag-btn-primary" onClick={save} disabled={saving}>
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

// ── Skills page ──────────────────────────────────────────────────────────────

export default function Skills() {
  const [skills, setSkills]       = useState([])
  const [agents, setAgents]       = useState([])
  const [selected, setSelected]   = useState(null)
  const [isNew, setIsNew]         = useState(false)
  const [isInstall, setIsInstall] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sd, ad] = await Promise.all([
        fetch('/api/skills').then(r => r.json()),
        fetch('/api/agents').then(r => r.json()),
      ])
      setSkills(sd.skills ?? [])
      setAgents(ad.agents ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelect = async (s) => {
    setIsNew(false)
    setIsInstall(false)
    try {
      const res  = await fetch(`/api/skills/${s.name}`)
      const data = await res.json()
      setSelected(res.ok ? data : s)
    } catch {
      setSelected(s)
    }
  }

  const handleSave = updated => {
    setSkills(prev => {
      const idx = prev.findIndex(s => s.name === updated.name)
      if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next }
      return [...prev, updated]
    })
    setSelected(updated)
    setIsNew(false)
    setIsInstall(false)
  }

  const handleDelete = name => {
    setSkills(prev => prev.filter(s => s.name !== name))
    setSelected(null)
    setIsNew(false)
  }

  const handleInstalled = async (skill) => {
    setIsInstall(false)
    // Fetch full skill data (with files) after install
    try {
      const res  = await fetch(`/api/skills/${skill.name}`)
      const data = await res.json()
      const full = res.ok ? data : skill
      setSkills(prev => [...prev, full])
      setSelected(full)
    } catch {
      setSkills(prev => [...prev, skill])
      setSelected(skill)
    }
  }

  const startNew = () => {
    setSelected(null)
    setIsNew(true)
    setIsInstall(false)
  }

  const startInstall = () => {
    setSelected(null)
    setIsNew(false)
    setIsInstall(true)
  }

  if (loading) return <div className="view-content"><p className="muted">Loading skills…</p></div>
  if (error)   return <div className="view-content"><p className="error-text">{error}</p></div>

  const activeSkill = isNew ? EMPTY_SKILL : selected

  return (
    <div className="ag-layout">
      {/* Left panel — skill list */}
      <div className="ag-list">
        <div className="ag-list-header">
          <span className="ag-list-title">Skills</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ag-new-btn" onClick={startInstall} title="Install from URL">↓ Install</button>
            <button className="ag-new-btn" onClick={startNew}>+ New</button>
          </div>
        </div>
        <div className="ag-list-items">
          {skills.map(s => (
            <button
              key={s.name}
              className={`ag-list-item ${selected?.name === s.name && !isNew && !isInstall ? 'ag-list-item-active' : ''}`}
              onClick={() => handleSelect(s)}
            >
              <div className="ag-list-name">{s.name}</div>
              <div className="ag-list-desc" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {s.path ?? `skills/${s.name}/SKILL.md`}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — editor / installer */}
      <div className="ag-detail">
        {isInstall ? (
          <>
            <div className="ag-detail-header">
              <div>
                <div className="ag-detail-title">Install Skill from URL</div>
                <div className="ag-detail-sub">Fetch a skill file from GitHub or any public URL</div>
              </div>
            </div>
            <InstallForm onInstalled={handleInstalled} onCancel={() => setIsInstall(false)} />
          </>
        ) : activeSkill ? (
          <>
            <div className="ag-detail-header">
              <div>
                <div className="ag-detail-title">
                  {isNew ? 'New Skill' : activeSkill.name}
                </div>
                {!isNew && <div className="ag-detail-sub">{activeSkill.path ?? `skills/${activeSkill.name}/SKILL.md`}</div>}
              </div>
            </div>
            <SkillForm
              key={isNew ? '__new__' : activeSkill.name}
              skill={activeSkill}
              agents={agents}
              onAgentsChange={setAgents}
              onSave={handleSave}
              onDelete={handleDelete}
              isNew={isNew}
            />
          </>
        ) : (
          <div className="ag-empty">
            <div className="ag-empty-icon">✦</div>
            <div className="ag-empty-text">Select a skill to edit, create a new one, or install from a URL.</div>
          </div>
        )}
      </div>
    </div>
  )
}
