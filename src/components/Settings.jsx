import { useEffect, useState } from 'react'

const mask = val =>
  val ? `${val.slice(0, 6)}${'•'.repeat(Math.max(0, val.length - 10))}${val.slice(-4)}` : '—'

function Section({ title, rows }) {
  return (
    <div className="panel">
      <div className="panel-header">{title}</div>
      <div className="settings-rows">
        {rows.map(([key, val]) => (
          <div key={key} className="setting-row">
            <span className="setting-key">{key}</span>
            <span className="setting-val mono">{val ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Settings() {
  const [config, setConfig]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => { setConfig(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="view-content">
      <div className="content-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Platform Configuration · Read-only</p>
      </div>

      {loading && <p className="muted">Loading...</p>}

      {config && (
        <>
          <Section title="AZURE OPENAI" rows={[
            ['Endpoint',   config.openai?.endpoint],
            ['Deployment', config.openai?.deployment],
            ['API Version', config.openai?.version],
            ['API Key',    mask(config.openai?.key)],
          ]} />

          <Section title="AZURE SENTINEL" rows={[
            ['Tenant ID',     config.sentinel?.tenantId],
            ['Client ID',     config.sentinel?.clientId],
            ['Client Secret', mask(config.sentinel?.clientSecret)],
            ['Workspace ID',  config.sentinel?.workspaceId],
          ]} />

          <div className="panel">
            <div className="panel-header">REGISTERED AGENTS</div>
            <div className="settings-rows">
              {(config.agents ?? []).map(a => (
                <div key={a.name} className="setting-row agent-row">
                  <div className="agent-row-name">
                    <span className="setting-key">{a.display_name}</span>
                    <div className="agent-tags">
                      {(a.tools ?? []).map(t => <span key={t} className="agent-tag">⚙ {t}</span>)}
                      {(a.skills ?? []).map(s => <span key={s} className="agent-tag skill-tag">★ {s}</span>)}
                    </div>
                  </div>
                  <span className="setting-val">{a.description?.trim().replace(/\s+/g, ' ').slice(0, 100)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
