import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_PATH  = path.join(__dirname, 'app.log')

const stream = fs.createWriteStream(LOG_PATH, { flags: 'a', encoding: 'utf8' })
stream.on('error', err => console.error('[Logger] Stream error:', err.message))

// ── Helpers ───────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString() }

function trunc(str, n = 400) {
  if (typeof str !== 'string') str = JSON.stringify(str) ?? ''
  return str.length > n ? str.slice(0, n) + `…(+${str.length - n})` : str
}

function indent(str) {
  return str.split('\n').map(l => '  ' + l).join('\n')
}

function writeLine(level, category, msg, extra) {
  const lvl  = level.padEnd(5)
  let line   = `${ts()} [${lvl}] [${category}] ${msg}`
  if (extra != null) {
    const s = typeof extra === 'string' ? extra : JSON.stringify(extra)
    line += s.includes('\n') ? '\n' + indent(s) : ' | ' + s
  }
  line += '\n'
  stream.write(line)
  const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log
  fn(line.trimEnd())
}

// Summarise a LangChain message object for the log
function fmtMsg(m, i) {
  try {
    const type    = m._getType?.() ?? 'unknown'
    const nameTag = m.name ? ` [${m.name}]` : ''
    const tcTag   = m.tool_calls?.length
      ? ` [tool_calls: ${m.tool_calls.map(tc => tc.name).join(', ')}]`
      : ''
    const raw     = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return `[${i}] ${type}${nameTag}${tcTag}: ${trunc(raw, 350)}`
  } catch {
    return `[${i}] <unparseable>`
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const log = {
  debug: (cat, msg, data) => writeLine('DEBUG', cat, msg, data),
  info:  (cat, msg, data) => writeLine('INFO',  cat, msg, data),
  warn:  (cat, msg, data) => writeLine('WARN',  cat, msg, data),
  error: (cat, msg, data) => writeLine('ERROR', cat, msg, data),

  // ── LLM call instrumentation ───────────────────────────────────────────

  llmRequest(agent, label, messages, toolCount = 0) {
    const header = `→ ${label} | ${messages.length} msg(s) | ${toolCount} tool(s) bound`
    const body   = messages.map(fmtMsg).join('\n')
    writeLine('DEBUG', `llm:${agent}`, header, '\n' + body)
  },

  llmResponse(agent, label, response) {
    const tcs     = response.tool_calls ?? []
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content ?? '')
    const tcNote  = tcs.length
      ? ` | tool_calls: ${tcs.map(tc => `${tc.name}(${trunc(JSON.stringify(tc.args), 120)})`).join(', ')}`
      : ''
    writeLine('DEBUG', `llm:${agent}`, `← ${label}${tcNote}`, trunc(content, 350) || undefined)
  },

  // ── Tool call instrumentation ──────────────────────────────────────────

  toolCall(agent, toolName, args) {
    writeLine('DEBUG', `tool:${agent}`, `→ ${toolName}`, trunc(JSON.stringify(args), 400))
  },

  toolResult(agent, toolName, result, isError = false) {
    const preview = trunc(typeof result === 'string' ? result : JSON.stringify(result), 400)
    writeLine(isError ? 'WARN' : 'DEBUG', `tool:${agent}`, `← ${toolName} ${isError ? 'ERROR' : 'OK'}`, preview)
  },

  // ── Eval instrumentation ───────────────────────────────────────────────

  evalResult(agent, attempt, score, threshold, passed, feedback, critique) {
    const status = passed ? 'PASS' : 'FAIL'
    const parts  = [`attempt=${attempt} score=${score}/${threshold} ${status}`, `feedback: ${trunc(feedback, 200)}`]
    if (critique) parts.push(`critique:\n${critique}`)
    writeLine(passed ? 'INFO' : 'WARN', `eval:${agent}`, parts[0], parts.slice(1).join('\n'))
  },

  // ── Visual separators ──────────────────────────────────────────────────

  agentStart(agent, query) {
    const bar = '─'.repeat(70)
    const msg = `\n${bar}\n  AGENT: ${agent}  |  ${ts()}\n  QUERY: ${trunc(query, 120)}\n${bar}`
    stream.write(msg + '\n')
    console.log(msg)
  },

  chatRequest(query) {
    const bar = '═'.repeat(70)
    const msg = `\n${bar}\n  CHAT REQUEST  |  ${ts()}\n  ${trunc(query, 140)}\n${bar}`
    stream.write(msg + '\n')
    console.log(msg)
  },
}

// ── Startup banner ────────────────────────────────────────────────────────────

const banner = [
  '',
  '╔' + '═'.repeat(70) + '╗',
  `║  BlueAgent started  |  ${ts()}`.padEnd(71) + '║',
  '╚' + '═'.repeat(70) + '╝',
  '',
].join('\n')
stream.write(banner + '\n')
console.log(banner)
