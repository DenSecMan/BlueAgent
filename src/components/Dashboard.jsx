import { useEffect, useState, useCallback } from 'react'

function parseOwner(raw) {
  if (!raw) return '—'
  if (typeof raw === 'string') {
    try { const o = JSON.parse(raw); return o.assignedTo || o.email || o.objectId || '—' } catch { return raw }
  }
  if (typeof raw === 'object') return raw.assignedTo || raw.email || raw.objectId || '—'
  return String(raw)
}

const SEV_COLORS = {
  High:          'var(--orange)',
  Medium:        'var(--yellow)',
  Low:           'var(--blue)',
  Informational: 'var(--text-dim)',
}

function SeverityBar({ label, count, max }) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="sev-bar-row">
      <span className="sev-bar-label">{label}</span>
      <div className="sev-bar-track">
        <div
          className="sev-bar-fill"
          style={{ width: `${pct}%`, background: SEV_COLORS[label] }}
        />
      </div>
      <span className="sev-bar-count">{count}</span>
    </div>
  )
}

function StatusDonut({ statusNew, statusActive, closed }) {
  const total = statusNew + statusActive + closed
  const cx = 60, cy = 60, r = 46, stroke = 12
  const circ = 2 * Math.PI * r

  const segments = [
    { value: statusNew,    color: 'var(--teal)',   label: 'New' },
    { value: statusActive, color: 'var(--orange)', label: 'Active' },
    { value: closed,       color: 'var(--green)',  label: 'Closed' },
  ]

  let offset = 0
  const arcs = segments.map(seg => {
    const dash = total > 0 ? (seg.value / total) * circ : 0
    const gap  = circ - dash
    const arc  = { ...seg, dash, gap, offset }
    offset += dash
    return arc
  })

  return (
    <div className="donut-wrap">
      <svg width="120" height="120" style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg3)" strokeWidth={stroke} />
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth={stroke}
            strokeDasharray={`${arc.dash} ${arc.gap}`}
            strokeDashoffset={-arc.offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px' }}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--text-bright)" fontSize="20" fontWeight="700" fontFamily="Inter,sans-serif">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--text-dim)" fontSize="10" fontFamily="Inter,sans-serif">TOTAL</text>
      </svg>
      <div className="donut-legend">
        {segments.map(seg => (
          <div key={seg.label} className="donut-legend-row">
            <span className="donut-dot" style={{ background: seg.color }} />
            <span className="donut-legend-label">{seg.label}</span>
            <span className="donut-legend-val">{seg.value}</span>
            <span className="donut-legend-pct muted">{total > 0 ? `${Math.round((seg.value / total) * 100)}%` : '0%'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrendChart({ trend, period }) {
  const W = 340, H = 100, PAD = { top: 10, right: 12, bottom: 28, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  if (!trend || trend.length === 0) {
    return <div className="trend-empty muted" style={{ fontSize: 12, padding: '20px 0', textAlign: 'center' }}>No trend data</div>
  }

  const subDay = period && (period.startsWith('PT') || period === 'PT24H')

  const max = Math.max(...trend.map(d => d.Count), 1)
  const points = trend.map((d, i) => {
    const x = PAD.left + (i / Math.max(trend.length - 1, 1)) * innerW
    const y = PAD.top + (1 - d.Count / max) * innerH
    return `${x},${y}`
  }).join(' ')

  const areaPoints = [
    `${PAD.left},${PAD.top + innerH}`,
    ...trend.map((d, i) => {
      const x = PAD.left + (i / Math.max(trend.length - 1, 1)) * innerW
      const y = PAD.top + (1 - d.Count / max) * innerH
      return `${x},${y}`
    }),
    `${PAD.left + innerW},${PAD.top + innerH}`,
  ].join(' ')

  const labels = trend.map(d => {
    const dt = new Date(d.Bucket ?? d.Day)
    return subDay
      ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `${dt.getDate()} ${dt.toLocaleString('default', { month: 'short' })}`
  })

  const tickCount = 3
  const yTicks = Array.from({ length: tickCount }, (_, i) => Math.round((max / (tickCount - 1)) * i))

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--teal)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((val, i) => {
        const y = PAD.top + (1 - val / max) * innerH
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fill="var(--text-dim)" fontSize="9" fontFamily="Consolas,monospace">{val}</text>
          </g>
        )
      })}
      <polygon points={areaPoints} fill="url(#trendGrad)" />
      <polyline points={points} fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {trend.map((d, i) => {
        const x = PAD.left + (i / Math.max(trend.length - 1, 1)) * innerW
        const y = PAD.top + (1 - d.Count / max) * innerH
        return <circle key={i} cx={x} cy={y} r="3" fill="var(--teal)" />
      })}
      {labels.map((lbl, i) => {
        const x = PAD.left + (i / Math.max(trend.length - 1, 1)) * innerW
        if (i % Math.max(1, Math.floor(trend.length / 4)) !== 0 && i !== trend.length - 1 && i !== 0) return null
        return (
          <text key={i} x={x} y={H - 4} textAnchor="middle" fill="var(--text-dim)" fontSize="9" fontFamily="Consolas,monospace">{lbl}</text>
        )
      })}
    </svg>
  )
}

const PERIODS = [
  { label: '30d',  value: 'P30D'  },
  { label: '14d',  value: 'P14D'  },
  { label: '7d',   value: 'P7D'   },
  { label: '1d',   value: 'PT24H' },
  { label: '12hr', value: 'PT12H' },
  { label: '4hr',  value: 'PT4H'  },
  { label: '1hr',  value: 'PT1H'  },
]

export default function Dashboard() {
  const [period, setPeriod]       = useState('PT1H')
  const [stats, setStats]         = useState(null)
  const [incidents, setIncidents] = useState([])
  const [trend, setTrend]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [refreshed, setRefreshed] = useState(null)

  const load = useCallback((p) => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`/api/dashboard/stats?period=${p}`).then(r => r.json()),
      fetch(`/api/incidents?period=${p}`).then(r => r.json()),
      fetch(`/api/dashboard/trend?period=${p}`).then(r => r.json()),
    ])
      .then(([s, d, t]) => {
        setStats(s)
        setIncidents((d.incidents ?? []).filter(i => i.Severity === 'High' || i.Severity === 'Medium'))
        setTrend(t.trend ?? [])
        setRefreshed(new Date())
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(period) }, [load, period])

  const handlePeriod = p => { setPeriod(p); load(p) }

  if (loading) return <div className="view-content"><p className="muted">Loading dashboard…</p></div>
  if (error)   return <div className="view-content"><p className="error-text">{error}</p></div>

  const s = stats ?? {}
  const total  = s.Total        ?? 0
  const open   = s.Open         ?? 0
  const closed = s.Closed       ?? 0
  const high   = s.SevHigh      ?? 0
  const medium = s.SevMedium    ?? 0
  const low    = s.SevLow       ?? 0
  const info   = s.SevInfo      ?? 0
  const sNew   = s.StatusNew    ?? 0
  const sActive= s.StatusActive ?? 0

  const sevMax = Math.max(high, medium, low, info, 1)

  const periodLabel = PERIODS.find(p => p.value === period)?.label ?? period
  const refreshStr  = refreshed
    ? `Refreshed ${refreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Azure Sentinel`
    : 'Azure Sentinel'

  return (
    <div className="view-content">
      <div className="dash-header">
        <div>
          <h1 className="page-title">Security Operations Dashboard</h1>
          <p className="page-subtitle">{refreshStr}</p>
        </div>
        <div className="dash-header-right">
          <div className="period-selector">
            {PERIODS.map(p => (
              <button
                key={p.value}
                className={`period-btn${period === p.value ? ' period-btn-active' : ''}`}
                onClick={() => handlePeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className="refresh-btn" onClick={() => load(period)}>⟳ Refresh</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="dash-stats">
        <div className="stat-card">
          <span className="stat-label">Total Incidents</span>
          <span className="stat-value">{total}</span>
          <span className="stat-sub muted">Last {periodLabel}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Open Incidents</span>
          <span className="stat-value" style={{ color: 'var(--orange)' }}>{open}</span>
          <span className="stat-sub muted">New + Active</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">High Severity</span>
          <span className="stat-value" style={{ color: 'var(--orange)' }}>{high}</span>
          <span className="stat-sub muted">Requires triage</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Resolved</span>
          <span className="stat-value" style={{ color: 'var(--green)' }}>{closed}</span>
          <span className="stat-sub muted">Closed incidents</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">New</span>
          <span className="stat-value" style={{ color: 'var(--teal)' }}>{sNew}</span>
          <span className="stat-sub muted">Awaiting triage</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active</span>
          <span className="stat-value" style={{ color: 'var(--yellow)' }}>{sActive}</span>
          <span className="stat-sub muted">In progress</span>
        </div>
      </div>

      {/* Middle row */}
      <div className="dash-mid">
        {/* Severity breakdown */}
        <div className="panel dash-panel-sev">
          <div className="panel-header">SEVERITY BREAKDOWN</div>
          <div className="sev-bars">
            {[
              { label: 'High',          count: high },
              { label: 'Medium',        count: medium },
              { label: 'Low',           count: low },
              { label: 'Informational', count: info },
            ].map(row => (
              <SeverityBar key={row.label} label={row.label} count={row.count} max={sevMax} />
            ))}
          </div>
        </div>

        {/* Status distribution */}
        <div className="panel dash-panel-status">
          <div className="panel-header">STATUS DISTRIBUTION</div>
          <div className="status-donut-wrap">
            <StatusDonut statusNew={sNew} statusActive={sActive} closed={closed} />
          </div>
        </div>

        {/* Incident trend */}
        <div className="panel dash-panel-trend">
          <div className="panel-header">INCIDENT TREND — {periodLabel.toUpperCase()}</div>
          <div className="trend-chart-wrap">
            <TrendChart trend={trend} period={period} />
          </div>
        </div>
      </div>

      {/* Open high/medium priority incidents */}
      <div className="panel">
        <div className="panel-header">OPEN HIGH-PRIORITY INCIDENTS</div>
        {incidents.length === 0
          ? <p className="panel-empty muted">No high or medium incidents in the last {periodLabel}.</p>
          : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map(inc => (
                    <tr key={inc.IncidentNumber}>
                      <td className="mono muted">#{inc.IncidentNumber}</td>
                      <td>{inc.Title}</td>
                      <td><span className={`badge sev-${inc.Severity?.toLowerCase()}`}>{inc.Severity}</span></td>
                      <td><span className={`badge status-${inc.Status?.toLowerCase().replace(/\s+/g, '-')}`}>{inc.Status}</span></td>
                      <td className="muted" style={{ fontSize: 12 }}>{parseOwner(inc.Owner)}</td>
                      <td className="mono muted">{inc.CreatedTime ? new Date(inc.CreatedTime).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  )
}
