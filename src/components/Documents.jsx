import { useEffect, useState, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' })

let _mermaidId = 0

function MermaidDiagram({ code }) {
  const [svg, setSvg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setErr(null)
    mermaid.render(`mermaid-doc-${++_mermaidId}`, code)
      .then(({ svg: s }) => { if (!cancelled) setSvg(s) })
      .catch(e => { if (!cancelled) setErr(e.message ?? String(e)) })
    return () => { cancelled = true }
  }, [code])

  if (err) return <pre className="mermaid-err">{err}</pre>

  return (
    <div className="mermaid-wrap">
      {svg === null
        ? <div className="mermaid-status">Rendering diagram…</div>
        : <div className="mermaid-svg-host" dangerouslySetInnerHTML={{ __html: svg }} />
      }
    </div>
  )
}

function markdownComponents() {
  return {
    code({ className, children }) {
      const lang = /language-(\w+)/.exec(className ?? '')?.[1]
      if (lang === 'mermaid') return <MermaidDiagram code={String(children).replace(/\n$/, '')} />
      return <code className="md-code">{children}</code>
    },
    pre({ children }) {
      const isMermaid = /language-mermaid/.test(children?.props?.className ?? '')
      if (isMermaid) return <>{children}</>
      return <pre className="md-pre">{children}</pre>
    },
  }
}

function buildTree(files) {
  const root = {}
  for (const f of files) {
    const parts = f.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {}
      node = node[parts[i]]
    }
    const leaf = parts[parts.length - 1]
    if (!(leaf in node)) node[leaf] = null
  }
  return root
}

const FILE_ICONS = { md: '◻', txt: '◻', json: '{}', yaml: 'YM', yml: 'YM', py: 'Py', js: 'JS', kql: 'KQ', pdf: 'PD' }

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

function DocFileTree({ files, selected, onSelect }) {
  const tree = useMemo(() => buildTree(files), [files])
  return (
    <div className="skill-file-panel" style={{ width: 240 }}>
      <div className="skill-file-panel-header">DOCUMENTATION</div>
      <div className="skill-tree-body">
        {Object.entries(tree).length === 0 ? (
          <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-dim)' }}>
            No documents found
          </div>
        ) : (
          Object.entries(tree).map(([k, v]) => (
            <TreeNode
              key={k}
              name={k}
              node={v}
              depth={0}
              filePath={k}
              selected={selected}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default function Documents() {
  const [files, setFiles]             = useState([])
  const [selected, setSelected]       = useState(null)
  const [content, setContent]         = useState('')
  const [loading, setLoading]         = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError]             = useState(null)
  const [fileError, setFileError]     = useState(null)

  useEffect(() => {
    fetch('/api/docs')
      .then(r => r.json())
      .then(d => { setFiles(d.files ?? []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const selectFile = useCallback(async (filePath) => {
    setSelected(filePath)
    setContent('')
    setFileError(null)
    setLoadingFile(true)
    try {
      const res  = await fetch(`/api/docs/file?path=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load file')
      setContent(data.content)
    } catch (e) {
      setFileError(e.message)
    } finally {
      setLoadingFile(false)
    }
  }, [])

  if (loading) return <div className="view-content"><p className="muted">Loading documentation…</p></div>
  if (error)   return <div className="view-content"><p className="error-text">{error}</p></div>

  const ext        = selected?.includes('.') ? selected.split('.').pop().toLowerCase() : ''
  const isMarkdown = ext === 'md'

  return (
    <div className="ag-layout">
      <DocFileTree files={files} selected={selected} onSelect={selectFile} />

      <div className="ag-detail">
        {selected ? (
          <>
            <div className="ag-detail-header">
              <div>
                <div className="ag-detail-title">{selected.split('/').pop()}</div>
                <div className="ag-detail-sub">documentation/{selected}</div>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
              {loadingFile ? (
                <p className="muted">Loading…</p>
              ) : fileError ? (
                <p className="error-text">{fileError}</p>
              ) : isMarkdown ? (
                <div className="md-body">
                  <ReactMarkdown components={markdownComponents()}>{content}</ReactMarkdown>
                </div>
              ) : (
                <pre style={{
                  fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)',
                  borderRadius: 6, padding: '14px 16px',
                }}>
                  {content}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--text-dim)', fontSize: 13,
          }}>
            Select a file to view its contents
          </div>
        )}
      </div>
    </div>
  )
}
