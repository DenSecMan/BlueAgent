import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'

export default function Reports() {
  const [reports, setReports]   = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    fetch('/api/reports')
      .then(r => r.json())
      .then(d => { setReports(d.reports ?? []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const passed = r => r.outcome === 'PASSED_AFTER_RETRIES'

  return (
    <div className="reports-view">
      <div className="reports-list">
        <div className="reports-list-header">
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Agent Lessons Learned · Memory Store</p>
        </div>

        {loading && <p className="panel-empty muted">Loading...</p>}
        {error   && <p className="panel-empty error-text">{error}</p>}
        {!loading && !error && reports.length === 0 && (
          <p className="panel-empty muted">No reports yet — they appear after eval retries.</p>
        )}

        {reports.map(r => (
          <button
            key={r.filename}
            className={`report-item ${selected?.filename === r.filename ? 'report-item-active' : ''}`}
            onClick={() => setSelected(r)}
          >
            <div className="report-item-top">
              <span className="report-agent">{r.agent ?? r.filename}</span>
              <span className={`badge ${passed(r) ? 'status-closed' : 'sev-high'}`}>
                {passed(r) ? 'Passed' : 'Failed'}
              </span>
            </div>
            <span className="report-query">{r.query ?? ''}</span>
            <span className="report-ts mono muted">{r.timestamp?.slice(0, 10) ?? ''}</span>
          </button>
        ))}
      </div>

      <div className="report-detail">
        {selected ? (
          <>
            <div className="detail-header">
              <span className="mono muted">{selected.filename}</span>
              <button className="detail-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="report-markdown">
              <ReactMarkdown>{selected.content}</ReactMarkdown>
            </div>
          </>
        ) : (
          <p className="panel-empty muted">Select a report to view details.</p>
        )}
      </div>
    </div>
  )
}
