import { useState } from 'react'

const TEMPLATES = [
  {
    label: 'Incidents by Severity',
    query: `SecurityIncident\n| where TimeGenerated > ago(24h)\n| summarize arg_max(TimeGenerated, *) by IncidentNumber\n| summarize Count=count() by Severity\n| sort by Count desc`,
  },
  {
    label: 'Open Incidents',
    query: `SecurityIncident\n| where TimeGenerated > ago(24h)\n| where Status in ("New", "Active")\n| summarize arg_max(TimeGenerated, *) by IncidentNumber\n| project IncidentNumber, Title, Severity, Status, CreatedTime\n| sort by CreatedTime desc`,
  },
  {
    label: 'Failed Sign-ins (7d)',
    query: `SigninLogs\n| where TimeGenerated > ago(7d)\n| where ResultType != 0\n| summarize Count=count() by UserPrincipalName, ResultDescription\n| sort by Count desc\n| take 20`,
  },
  {
    label: 'Top Alert Rules',
    query: `SecurityAlert\n| where TimeGenerated > ago(24h)\n| summarize Count=count() by AlertName\n| sort by Count desc\n| take 20`,
  },
]

const TIMESPANS = [
  { label: 'Last 1 hour',  value: 'PT1H'  },
  { label: 'Last 24 hours', value: 'PT24H' },
  { label: 'Last 7 days',  value: 'P7D'   },
  { label: 'Last 30 days', value: 'P30D'  },
]

export default function Analytics() {
  const [query, setQuery]     = useState(TEMPLATES[0].query)
  const [timespan, setTimespan] = useState('PT24H')
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const run = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res  = await fetch('/api/analytics/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query, timespan }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="view-content">
      <div className="content-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">KQL Query Editor · Azure Log Analytics</p>
      </div>

      <div className="panel">
        <div className="panel-header">QUERY EDITOR</div>
        <div className="kql-toolbar">
          {TEMPLATES.map(t => (
            <button key={t.label} className="template-btn" onClick={() => setQuery(t.query)}>
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          className="kql-editor"
          value={query}
          onChange={e => setQuery(e.target.value)}
          rows={8}
          spellCheck={false}
        />
        <div className="kql-actions">
          <select className="filter-select" value={timespan} onChange={e => setTimespan(e.target.value)}>
            {TIMESPANS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button className="run-btn" onClick={run} disabled={loading}>
            {loading ? 'Running...' : '▶  Run Query'}
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {result && (
        <div className="panel">
          <div className="panel-header">RESULTS — {result.count} rows</div>
          <div className="table-wrap table-scroll">
            <table className="data-table">
              <thead>
                <tr>{result.columns.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => <td key={j} className="mono">{String(cell ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
