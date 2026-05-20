import 'dotenv/config'
import express from 'express'
import { AzureChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { loadRegistry, getAgent, invalidateRegistry } from './agentLoader.js'
import yaml from 'js-yaml'
import { runAgent } from './agentRunner.js'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { log } from './logger.js'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const MEMORY_DIR  = path.join(__dirname, 'memory')
const AGENTS_DIR  = path.join(__dirname, 'agents')
const SKILLS_DIR  = path.join(__dirname, 'skills')
const TOOLS_DIR   = path.join(__dirname, 'tools')
const DOCS_DIR    = path.join(__dirname, 'documentation')

const SAFE_NAME = /^[a-z0-9_-]+$/i

// ── Azure Log Analytics client ───────────────────────────────────────────
let _laToken    = null
let _laTokenExp = 0

async function getLogAnalyticsToken() {
  if (_laToken && Date.now() < _laTokenExp) return _laToken
  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    resource:      'https://api.loganalytics.io',
  })
  const res  = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/token`,
    { method: 'POST', body: params }
  )
  const data = await res.json()
  _laToken    = data.access_token
  _laTokenExp = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000
  return _laToken
}

async function queryLogAnalytics(kql, timespan = 'PT24H') {
  const token = await getLogAnalyticsToken()
  const res   = await fetch(
    `https://api.loganalytics.io/v1/workspaces/${process.env.AZURE_WORKSPACE_ID}/query`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: kql, timespan }),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Log Analytics ${res.status}: ${err}`)
  }
  const data    = await res.json()
  const table   = data.tables?.[0] ?? {}
  const columns = (table.columns ?? []).map(c => c.name)
  const rows    = table.rows ?? []
  return { columns, rows, count: rows.length }
}

const app = express()
app.use(express.json({ limit: '20mb' }))

const MODEL_CONFIG = {
  azureOpenAIEndpoint:          process.env.AZURE_OPENAI_ENDPOINT,
  azureOpenAIApiKey:            process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiVersion:        process.env.AZURE_OPENAI_API_VERSION,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_CHAT || process.env.AZURE_OPENAI_DEPLOYMENT,
}

// ── Orchestrator ────────────────────────────────────────────────────────
const OrchestratorDecision = z.object({
  agents: z.array(z.string()).describe(
    'Agent names to invoke, in order. Use exact names from the registry.'
  ),
  workflow: z.enum(['single', 'sequential']).describe(
    'single: one agent fully handles the request; sequential: chain agents in order, each receiving the previous output as context'
  ),
  reasoning: z.string().describe('One sentence explaining the agent selection'),
})

const orchestratorModel = new AzureChatOpenAI({ ...MODEL_CONFIG, temperature: 0 })
  .withStructuredOutput(OrchestratorDecision)

// ── Load registry at startup ────────────────────────────────────────────
let registry = []
loadRegistry()
  .then(r => {
    registry = r
    log.info('registry', `Loaded ${r.length} agents: ${r.map(a => a.name).join(', ')}`)
  })
  .catch(err => log.error('registry', 'Failed to load', err.message))

// ── Period helpers ───────────────────────────────────────────────────────
const PERIOD_MAP = {
  'PT1H':  { ago: '1h',  bin: '10m' },
  'PT4H':  { ago: '4h',  bin: '30m' },
  'PT12H': { ago: '12h', bin: '1h'  },
  'PT24H': { ago: '24h', bin: '2h'  },
  'PT24H': { ago: '24h', bin: '2h'  },
  'P7D':   { ago: '7d',  bin: '1d'  },
  'P14D':  { ago: '14d', bin: '1d'  },
  'P30D':  { ago: '30d', bin: '1d'  },
}
function resolvePeriod(raw) {
  return PERIOD_MAP[raw] ? raw : 'PT1H'
}

// ── Dashboard stats ──────────────────────────────────────────────────────
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const period = resolvePeriod(req.query.period)
    const { ago } = PERIOD_MAP[period]
    const kql = `SecurityIncident
| where TimeGenerated > ago(${ago})
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| summarize
    Total         = count(),
    SevHigh       = countif(Severity == "High"),
    SevMedium     = countif(Severity == "Medium"),
    SevLow        = countif(Severity == "Low"),
    SevInfo       = countif(Severity == "Informational"),
    StatusNew     = countif(Status == "New"),
    StatusActive  = countif(Status == "Active"),
    Closed        = countif(Status == "Closed"),
    Open          = countif(Status in ("New", "Active"))`
    const { columns, rows } = await queryLogAnalytics(kql, period)
    const stats = rows.length ? Object.fromEntries(columns.map((c, i) => [c, rows[0][i]])) : {}
    res.json(stats)
  } catch (err) {
    log.error('api:dashboard', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Incident trend ───────────────────────────────────────────────────────
app.get('/api/dashboard/trend', async (req, res) => {
  try {
    const period = resolvePeriod(req.query.period)
    const { ago, bin } = PERIOD_MAP[period]
    const kql = `SecurityIncident
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| where CreatedTime > ago(${ago})
| summarize Count = count() by Bucket = bin(CreatedTime, ${bin})
| order by Bucket asc`
    const { columns, rows } = await queryLogAnalytics(kql, period)
    const trend = rows.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
    res.json({ trend })
  } catch (err) {
    log.error('api:trend', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Incidents list ───────────────────────────────────────────────────────
app.get('/api/incidents', async (req, res) => {
  try {
    const period = resolvePeriod(req.query.period)
    const { ago } = PERIOD_MAP[period]
    const kql = `SecurityIncident
| where TimeGenerated > ago(${ago})
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| extend Description  = column_ifexists("Description",  "")
| extend Labels       = column_ifexists("Labels",       "[]")
| extend IncidentUrl  = column_ifexists("IncidentUrl",  "")
| extend AlertIds     = column_ifexists("AlertIds",     "[]")
| project IncidentNumber, Title, Severity, Status, Owner, CreatedTime, LastModifiedTime, Description, Labels, IncidentUrl, AlertIds
| sort by CreatedTime desc
| take 200`
    const { columns, rows } = await queryLogAnalytics(kql, period)
    const incidents = rows.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
    res.json({ incidents })
  } catch (err) {
    log.error('api:incidents', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Incident entities (from linked SecurityAlert records) ────────────────
async function getIncidentEntities(incNum) {
  if (isNaN(incNum)) return []
  const idKql = `SecurityIncident
| where IncidentNumber == ${incNum}
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| extend AlertIds = column_ifexists("AlertIds", "[]")
| project AlertIds`
  const idResult = await queryLogAnalytics(idKql, 'P30D')
  if (!idResult.rows.length) return []

  let alertIds = idResult.rows[0][0]
  if (typeof alertIds === 'string') { try { alertIds = JSON.parse(alertIds) } catch { alertIds = [] } }
  if (!Array.isArray(alertIds) || !alertIds.length) return []

  const idList = alertIds.map(id => `"${id}"`).join(',')
  const entKql = `SecurityAlert
| where SystemAlertId in (${idList})
| summarize arg_max(TimeGenerated, Entities) by SystemAlertId
| mv-expand Entity = todynamic(Entities)
| where isnotempty(Entity)
| project Entity`
  const entResult = await queryLogAnalytics(entKql, 'P30D')
  return entResult.rows.map(r => {
    const v = r[0]
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
    return v
  }).filter(Boolean)
}

app.get('/api/incidents/:incidentNumber/entities', async (req, res) => {
  try {
    const incNum = parseInt(req.params.incidentNumber, 10)
    const entities = await getIncidentEntities(incNum)
    res.json({ entities })
  } catch (err) {
    log.error('api:entities', err.message)
    res.json({ entities: [] })
  }
})

// Format raw Sentinel entity objects as a natural-language list for threat_analyst.
function formatEntitiesForAnalysis(entities) {
  const lines = []
  for (const e of entities) {
    if (!e || typeof e !== 'object') continue
    const t = String(e.Type ?? e.type ?? '').toLowerCase()
    if (t === 'ip') {
      const addr = e.Address ?? e.address
      if (addr) lines.push(`- IP address: ${addr}`)
    } else if (t === 'account') {
      const name = e.Name ?? e.name
      const upn  = e.UPNSuffix ?? e.upnSuffix
      const full = (name && upn) ? `${name}@${upn}` : (name ?? e.AadUserId ?? e.aadUserId ?? e.Sid ?? e.sid)
      if (full) lines.push(`- Account: ${full}`)
    } else if (t === 'host') {
      const host = e.HostName ?? e.hostName ?? e.NetBiosName ?? e.netBiosName ?? e.DnsDomain ?? e.dnsDomain
      if (host) lines.push(`- Host: ${host}`)
    } else if (t === 'file') {
      if (e.Name ?? e.name) lines.push(`- File: ${e.Name ?? e.name}`)
    } else if (t === 'filehash' || t === 'file-hash') {
      const algo = e.Algorithm ?? e.algorithm ?? 'hash'
      const val  = e.Value ?? e.value
      if (val) lines.push(`- File hash (${algo}): ${val}`)
    } else if (t === 'url') {
      if (e.Url ?? e.url) lines.push(`- URL: ${e.Url ?? e.url}`)
    } else if (t === 'dnsresolution' || t === 'dns') {
      if (e.DomainName ?? e.domainName) lines.push(`- Domain: ${e.DomainName ?? e.domainName}`)
    } else if (t === 'cve' || t === 'vulnerability') {
      const id = e.CveId ?? e.cveId ?? e.Id ?? e.id
      if (id) lines.push(`- CVE: ${id}`)
    } else if (t) {
      lines.push(`- ${e.Type ?? e.type}: ${JSON.stringify(e).slice(0, 200)}`)
    }
  }
  return lines.length ? lines.join('\n') : '(no entities)'
}

// ── Prompty / investigation suggestions ──────────────────────────────────
const PromptySchema = z.object({
  prompts: z.array(z.string()).length(5).describe(
    "Exactly 5 next-step SOC investigation prompts written in the user's voice (first person), " +
    "each referencing specific incident evidence (entity, timestamp, IP, hash, account, etc.) and " +
    "ready to copy-paste as the next chat message. Ordered from highest to lowest investigative priority."
  ),
})

async function callPromptyStructured(promptyAgent, humanContent) {
  const model = new AzureChatOpenAI({
    ...MODEL_CONFIG,
    temperature: promptyAgent.model?.temperature ?? 0.5,
  }).withStructuredOutput(PromptySchema)
  const messages = [
    new SystemMessage(promptyAgent._systemPrompt ?? promptyAgent.system_prompt),
    new HumanMessage(humanContent),
  ]
  log.llmRequest('prompty', 'suggest', messages)
  const result = await model.invoke(messages)
  log.llmResponse('prompty', 'suggest', {
    content: `prompts=[${result.prompts.map(p => p.slice(0, 60).replace(/\s+/g, ' ')).join(' | ')}]`,
    tool_calls: [],
  })
  return result.prompts
}

app.post('/api/investigate/:incidentNumber', async (req, res) => {
  const incNum = parseInt(req.params.incidentNumber, 10)
  if (isNaN(incNum)) return res.status(400).json({ error: 'Invalid incident number' })
  try {
    const incidentContext = String(req.body?.incidentContext ?? '').trim()
    if (!incidentContext) return res.status(400).json({ error: 'incidentContext is required' })

    const entities  = await getIncidentEntities(incNum)
    const entityStr = formatEntitiesForAnalysis(entities)

    let threatIntel = null
    if (entities.length > 0) {
      const threatAgent = await getAgent('threat_analyst')
      if (threatAgent) {
        const query = `Analyse the following indicators of compromise extracted from Microsoft Sentinel incident #${incNum} and summarise what threat intelligence sources report for each one:\n\n${entityStr}`
        try {
          threatIntel = await runAgent(threatAgent, [{ role: 'user', text: query }])
        } catch (err) {
          log.warn('investigate', `threat_analyst failed: ${err.message}`)
        }
      }
    }

    const promptyAgent = await getAgent('prompty')
    if (!promptyAgent) return res.status(500).json({ error: 'prompty agent not found' })

    const promptyHuman = [
      `## Incident #${incNum} — full context`,
      incidentContext,
      threatIntel ? `\n## Threat intelligence summary (just produced by Threat Analyst)\n${threatIntel}` : '',
      `\n## Conversation so far`,
      '(This is the start of the investigation — no prior chat messages.)',
      `\nProduce exactly 5 next-step investigation prompts a Tier 3 SOC analyst would ask now, grounded in the specific entities and findings above.`,
    ].filter(Boolean).join('\n')

    const prompts = await callPromptyStructured(promptyAgent, promptyHuman)

    res.json({
      threatIntel,
      threatIntelAgent:      'threat_analyst',
      threatIntelAgentLabel: 'Threat Analyst',
      prompts,
      entitiesCount: entities.length,
    })
  } catch (err) {
    log.error('investigate', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/suggest', async (req, res) => {
  try {
    const messages        = Array.isArray(req.body?.messages) ? req.body.messages : []
    const incidentContext = String(req.body?.incidentContext ?? '').trim()

    const promptyAgent = await getAgent('prompty')
    if (!promptyAgent) return res.status(500).json({ error: 'prompty agent not found' })

    const transcript = messages.length
      ? messages.map(m => {
          const who = m.role === 'user' ? 'User' : (m.agentLabel ?? m.agent ?? 'AI')
          return `**${who}:** ${String(m.text ?? '').slice(0, 4000)}`
        }).join('\n\n')
      : '(no messages yet)'

    const promptyHuman = [
      `## Incident context`,
      incidentContext || '(no incident loaded)',
      `\n## Conversation so far`,
      transcript,
      `\nProduce exactly 5 next-step investigation prompts grounded in the conversation above. Do not repeat prompts already asked.`,
    ].join('\n')

    const prompts = await callPromptyStructured(promptyAgent, promptyHuman)
    res.json({ prompts })
  } catch (err) {
    log.error('suggest', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Incident comments ────────────────────────────────────────────────────
app.get('/api/incidents/:incidentNumber/comments', async (req, res) => {
  try {
    const incNum = parseInt(req.params.incidentNumber, 10)
    if (isNaN(incNum)) return res.json({ comments: [] })

    const kql = `SecurityIncident
| where IncidentNumber == ${incNum}
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| extend Comments = column_ifexists("Comments", "[]")
| project Comments`
    const result = await queryLogAnalytics(kql, 'P30D')
    if (!result.rows.length) return res.json({ comments: [] })

    let raw = result.rows[0][0]
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = [] } }
    const comments = Array.isArray(raw) ? raw : []
    res.json({ comments })
  } catch (err) {
    log.error('api:comments', err.message)
    res.json({ comments: [] })
  }
})

// ── Analytics KQL runner ─────────────────────────────────────────────────
app.post('/api/analytics/run', async (req, res) => {
  try {
    const { query, timespan = 'PT24H' } = req.body
    if (!query) return res.status(400).json({ error: 'query is required' })
    const result = await queryLogAnalytics(query, timespan)
    res.json(result)
  } catch (err) {
    log.error('api:analytics', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Reports (agent memory) ───────────────────────────────────────────────
app.get('/api/reports', async (req, res) => {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true })
    const files = (await fs.readdir(MEMORY_DIR))
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()

    const reports = await Promise.all(files.map(async filename => {
      const content = await fs.readFile(path.join(MEMORY_DIR, filename), 'utf8')
      const meta    = {}
      content.split('\n').forEach(line => {
        const m = line.match(/^(\w+):\s*(.+)$/)
        if (m) meta[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
      })
      return { filename, ...meta, content }
    }))

    res.json({ reports })
  } catch (err) {
    log.error('api:reports', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── Settings (sanitized) ─────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  const agents = registry.map(({ name, display_name, description, tools, skills }) =>
    ({ name, display_name, description, tools, skills })
  )
  res.json({
    openai: {
      endpoint:   process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT_CHAT || process.env.AZURE_OPENAI_DEPLOYMENT,
      version:    process.env.AZURE_OPENAI_API_VERSION,
      key:        process.env.AZURE_OPENAI_API_KEY,
    },
    sentinel: {
      tenantId:     process.env.AZURE_TENANT_ID,
      clientId:     process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      workspaceId:  process.env.AZURE_WORKSPACE_ID,
    },
    agents,
  })
})

// ── Chat ─────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body
    const lastMessage  = messages.at(-1)?.text ?? ''

    log.chatRequest(lastMessage)

    // Lazy load if startup wasn't complete
    if (!registry.length) registry = await loadRegistry()

    // Build agent summary for orchestrator context
    const agentList = registry
      .map(a => `- ${a.name} (${a.display_name}): ${a.description?.trim().replace(/\s+/g, ' ')}`)
      .join('\n')

    // Orchestrator picks agent(s) and workflow
    const orchMessages = [
      new SystemMessage(
        `You are BlueAgent, an AI orchestrator. Route user requests to the right specialist agents.\n\n` +
        `Available agents:\n${agentList}\n\n` +
        `Workflow rules:\n` +
        `- single: one agent fully handles the request\n` +
        `- sequential: chain agents in order — each receives the previous agent's output as context\n\n` +
        `Routing rules:\n` +
        `- Meta-questions about the BlueAgent platform itself ("which agents are available", "what can you do", "list your capabilities", "how does this work") MUST route to blueagent.\n` +
        `- Always pick the most specific agent otherwise.\n` +
        `- Use blueagent when no specialist fits.`
      ),
      new HumanMessage(lastMessage),
    ]
    log.llmRequest('orchestrator', 'routing', orchMessages)
    const decision = await orchestratorModel.invoke(orchMessages)
    log.llmResponse('orchestrator', 'routing', {
      content: `[${decision.agents.join(' → ')}] (${decision.workflow}) — ${decision.reasoning}`,
      tool_calls: [],
    })
    log.info('orchestrator', `route: [${decision.agents.join(' → ')}] workflow=${decision.workflow}`, decision.reasoning)

    // ── Execute ────────────────────────────────────────────────────────
    if (decision.workflow === 'sequential') {
      let context = null
      let reply   = ''
      for (const name of decision.agents) {
        const config = await getAgent(name)
        if (!config) { log.warn('orchestrator', `Unknown agent: ${name}`); continue }
        reply   = await runAgent(config, messages, context)
        context = reply
      }
      const last   = await getAgent(decision.agents.at(-1))
      return res.json({
        reply,
        agent:      decision.agents.at(-1),
        agentLabel: last?.display_name ?? decision.agents.at(-1),
        agents:     decision.agents,
      })
    }

    // Single agent
    const name   = decision.agents[0] ?? 'blueagent'
    const config = await getAgent(name) ?? await getAgent('blueagent')
    const reply  = await runAgent(config, messages)
    return res.json({
      reply,
      agent:      config.name,
      agentLabel: config.display_name,
    })

  } catch (err) {
    log.error('chat', err.message, err.stack?.split('\n')[1]?.trim())
    res.status(500).json({ error: err.message })
  }
})

// ── Agent management ─────────────────────────────────────────────────────
app.get('/api/agents/options', async (req, res) => {
  try {
    const [skillEntries, toolFiles] = await Promise.all([
      fs.readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => []),
      fs.readdir(TOOLS_DIR).catch(() => []),
    ])
    const seen   = new Set()
    const skills = []
    // Folder format: skills/{name}/SKILL.md (takes precedence)
    for (const e of skillEntries) {
      if (!e.isDirectory()) continue
      try { await fs.access(path.join(SKILLS_DIR, e.name, 'SKILL.md')); skills.push(e.name); seen.add(e.name) } catch {}
    }
    // Flat format fallback: skills/{name}.md
    for (const e of skillEntries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      const n = e.name.replace('.md', '')
      if (!seen.has(n)) skills.push(n)
    }
    const tools = toolFiles
      .filter(f => f.endsWith('.js') || f.endsWith('.py'))
      .map(f => f.replace(/\.(js|py)$/, ''))
    res.json({ skills, tools })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/agents', async (req, res) => {
  try {
    const files  = (await fs.readdir(AGENTS_DIR)).filter(f => f.endsWith('.yaml'))
    const agents = await Promise.all(files.map(async f => {
      const raw = await fs.readFile(path.join(AGENTS_DIR, f), 'utf8')
      const cfg = yaml.load(raw)
      const { _systemPrompt, ...rest } = cfg
      return rest
    }))
    res.json({ agents })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/agents/:name', async (req, res) => {
  const { name } = req.params
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid agent name' })
  try {
    const raw = await fs.readFile(path.join(AGENTS_DIR, `${name}.yaml`), 'utf8')
    const cfg = yaml.load(raw)
    const { _systemPrompt, ...rest } = cfg
    res.json(rest)
  } catch {
    res.status(404).json({ error: 'Agent not found' })
  }
})

app.post('/api/agents', async (req, res) => {
  const agent = req.body
  if (!agent?.name || !SAFE_NAME.test(agent.name)) return res.status(400).json({ error: 'Invalid or missing agent name' })
  const filePath = path.join(AGENTS_DIR, `${agent.name}.yaml`)
  try {
    await fs.access(filePath)
    return res.status(409).json({ error: `Agent "${agent.name}" already exists` })
  } catch { /* file does not exist — good */ }
  try {
    await fs.writeFile(filePath, yaml.dump(agent, { lineWidth: 120 }), 'utf8')
    invalidateRegistry()
    registry = await loadRegistry()
    res.status(201).json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/agents/:name', async (req, res) => {
  const { name } = req.params
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid agent name' })
  const filePath = path.join(AGENTS_DIR, `${name}.yaml`)
  try { await fs.access(filePath) } catch { return res.status(404).json({ error: 'Agent not found' }) }
  try {
    const agent = { ...req.body, name }
    await fs.writeFile(filePath, yaml.dump(agent, { lineWidth: 120 }), 'utf8')
    invalidateRegistry()
    registry = await loadRegistry()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/agents/:name', async (req, res) => {
  const { name } = req.params
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid agent name' })
  if (name === 'blueagent') return res.status(400).json({ error: 'Cannot delete the default agent' })
  const filePath = path.join(AGENTS_DIR, `${name}.yaml`)
  try { await fs.access(filePath) } catch { return res.status(404).json({ error: 'Agent not found' }) }
  try {
    await fs.unlink(filePath)
    invalidateRegistry()
    registry = await loadRegistry()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Skills management ─────────────────────────────────────────────────────
const SkillAnalysisSchema = z.object({
  report:     z.string().describe('Detailed analysis of the skill content with specific observations'),
  confidence: z.number().int().min(1).max(100).describe('Risk score 1–100: 1 = definitely safe, 100 = definitely malicious'),
  findings:   z.array(z.string()).describe('Specific concerns found; empty array if none'),
  verdict:    z.enum(['safe', 'suspicious', 'malicious']).describe('Overall verdict'),
})

app.post('/api/skills/analyze', async (req, res) => {
  const { name, content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' })
  try {
    const agent = await getAgent('skill_analyzer')
    if (!agent) return res.status(500).json({ error: 'skill_analyzer agent not found — check agents/skill_analyzer.yaml' })
    const analyzerModel = new AzureChatOpenAI({ ...MODEL_CONFIG, temperature: 0.1 })
      .withStructuredOutput(SkillAnalysisSchema)
    const result = await analyzerModel.invoke([
      new SystemMessage(agent._systemPrompt ?? agent.system_prompt),
      new HumanMessage(`Analyse this skill file named "${name || 'unknown'}":\n\n\`\`\`markdown\n${content}\n\`\`\``),
    ])
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GitHub folder downloader ──────────────────────────────────────────────
const GH_HEADERS = { 'User-Agent': 'BlueAgent-SkillInstaller/1.0', 'Accept': 'application/vnd.github.v3+json' }

async function downloadGitHubFolder(owner, repo, branch, dirPath) {
  const treeUrl  = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  const treeResp = await fetch(treeUrl, { signal: AbortSignal.timeout(15000), headers: GH_HEADERS })
  if (!treeResp.ok) return null
  const tree   = await treeResp.json()
  const prefix = dirPath.replace(/\/$/, '') + '/'
  const blobs  = (tree.tree ?? []).filter(i => i.type === 'blob' && i.path.startsWith(prefix))
  if (blobs.length === 0) return null

  const files = {}
  for (const blob of blobs) {
    const relPath = blob.path.slice(prefix.length)
    const rawUrl  = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${blob.path}`
    const r = await fetch(rawUrl, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': GH_HEADERS['User-Agent'] } })
    if (r.ok) {
      const text = await r.text()
      if (!/^\s*<!DOCTYPE|^\s*<html/i.test(text)) files[relPath] = text
    }
  }
  return Object.keys(files).length ? files : null
}

app.post('/api/skills/fetch', async (req, res) => {
  const raw = (req.body.url ?? '').trim()
  if (!raw) return res.status(400).json({ error: 'URL is required' })
  try {
    // ── 1. npx skills add <github_url> --skill <name> ─────────────────────
    const npxMatch = raw.match(/npx\s+skills\s+add\s+(https?:\/\/github\.com\/[^\s]+)\s+--skill\s+([^\s]+)/i)
    if (npxMatch) {
      const [, repoUrl, skillFlag] = npxMatch
      const ghMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/)
      if (!ghMatch) return res.status(400).json({ error: 'Could not parse GitHub repo URL from command' })
      const [, owner, repo] = ghMatch
      // Build candidate folder names: exact, hyphen↔underscore swaps,
      // and stripped -skill/-skills suffix (skills.sh registry names often
      // differ from the actual folder name, e.g. "kql-skill" → folder "kql")
      const stripped = skillFlag.replace(/-skills?$/i, '').replace(/_skills?$/i, '')
      const unique = [...new Set([
        skillFlag,
        skillFlag.replace(/-/g, '_'),
        skillFlag.replace(/_/g, '-'),
        stripped,
        stripped.replace(/-/g, '_'),
        stripped.replace(/_/g, '-'),
      ])]
      for (const branch of ['main', 'master']) {
        for (const skill of unique) {
          for (const dir of [`skills/${skill}`, skill]) {
            const files = await downloadGitHubFolder(owner, repo.replace(/\.git$/, ''), branch, dir)
            if (files) {
              const name = skill.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
              return res.json({ suggestedName: name, content: files['SKILL.md'] ?? '', files })
            }
          }
        }
      }
      return res.status(400).json({ error: `Could not find skill "${skillFlag}" in ${owner}/${repo}. Try the GitHub /tree/ URL directly instead.` })
    }

    // ── 2. skills.sh page URL → full GitHub folder ────────────────────────
    const skillsSh = raw.match(/^https?:\/\/(?:www\.)?skills\.sh\/([^/]+)\/([^/]+)\/([^/?#]+)/)
    if (skillsSh) {
      const [, org, repo, skill] = skillsSh
      for (const branch of ['main', 'master']) {
        const files = await downloadGitHubFolder(org, repo, branch, `skills/${skill}`)
        if (files) {
          const name = skill.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
          return res.json({ suggestedName: name, content: files['SKILL.md'] ?? '', files })
        }
      }
      return res.status(400).json({ error: `Could not locate skill "${skill}" on GitHub. The repository may be private.` })
    }

    // ── 3. GitHub /tree/ URL → full folder download ───────────────────────
    const ghTree = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/)
    if (ghTree) {
      const [, owner, repo, branch, dirPath] = ghTree
      const files = await downloadGitHubFolder(owner, repo, branch, dirPath)
      if (!files) return res.status(400).json({ error: `No files found at that path. Check the URL is correct and the repository is public.` })
      const name = dirPath.split('/').pop().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
      return res.json({ suggestedName: name, content: files['SKILL.md'] ?? Object.values(files)[0] ?? '', files })
    }

    // ── 4. GitHub /blob/ → single file ───────────────────────────────────
    const ghBlob = raw.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/)
    const fetchUrl = ghBlob ? `https://raw.githubusercontent.com/${ghBlob[1]}/${ghBlob[2]}` : raw

    const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': GH_HEADERS['User-Agent'] } })
    if (!resp.ok) throw new Error(`Remote server responded with ${resp.status} ${resp.statusText}`)
    const content = await resp.text()
    if (/^\s*<!DOCTYPE|^\s*<html/i.test(content)) {
      return res.status(400).json({ error: 'The URL returned an HTML page. For GitHub directories use the /tree/ URL; for files use the /blob/ URL.' })
    }
    const filename      = fetchUrl.split('/').pop().split('?')[0].replace(/\.md$/i, '')
    const suggestedName = filename.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'new_skill'
    return res.json({ suggestedName, content })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Skill path helpers ────────────────────────────────────────────────────
// Folder format (new): skills/{name}/SKILL.md
// Flat format (legacy): skills/{name}.md
// Reads check folder first; writes always use folder format.
async function findSkillPath(name) {
  const folder = path.join(SKILLS_DIR, name, 'SKILL.md')
  const flat   = path.join(SKILLS_DIR, `${name}.md`)
  try { await fs.access(folder); return { filePath: folder, isFolder: true } } catch {}
  try { await fs.access(flat);   return { filePath: flat,   isFolder: false } } catch {}
  return null
}

app.get('/api/skills', async (req, res) => {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true })
    const skills  = []
    const seen    = new Set()

    // Folder format first
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const skillFile = path.join(SKILLS_DIR, e.name, 'SKILL.md')
      try {
        const content = await fs.readFile(skillFile, 'utf8')
        skills.push({ name: e.name, content, path: `skills/${e.name}/SKILL.md` })
        seen.add(e.name)
      } catch {}
    }

    // Flat format fallback
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      const name = e.name.replace('.md', '')
      if (seen.has(name)) continue
      const content = await fs.readFile(path.join(SKILLS_DIR, e.name), 'utf8')
      skills.push({ name, content, path: `skills/${e.name}` })
    }

    res.json({ skills })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function listFilesRecursive(dir, base = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) {
      files.push(...await listFilesRecursive(path.join(dir, e.name), rel))
    } else {
      files.push(rel)
    }
  }
  return files
}

app.get('/api/skills/:name', async (req, res) => {
  const { name } = req.params
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid skill name' })
  const found = await findSkillPath(name)
  if (!found) return res.status(404).json({ error: 'Skill not found' })
  try {
    const content = await fs.readFile(found.filePath, 'utf8')
    const relPath = found.isFolder ? `skills/${name}/SKILL.md` : `skills/${name}.md`
    let files = null
    if (found.isFolder) {
      files = await listFilesRecursive(path.join(SKILLS_DIR, name))
    }
    res.json({ name, content, path: relPath, files })
  } catch {
    res.status(404).json({ error: 'Skill not found' })
  }
})

app.get('/api/skills/:name/file', async (req, res) => {
  const { name } = req.params
  const filePath  = req.query.path
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid skill name' })
  if (!filePath)              return res.status(400).json({ error: 'Missing path query param' })
  const found = await findSkillPath(name)
  if (!found?.isFolder)      return res.status(404).json({ error: 'Skill folder not found' })
  const fullPath = path.resolve(path.join(SKILLS_DIR, name, filePath))
  const skillDir = path.resolve(path.join(SKILLS_DIR, name))
  if (!fullPath.startsWith(skillDir + path.sep)) return res.status(400).json({ error: 'Invalid file path' })
  try {
    const content = await fs.readFile(fullPath, 'utf8')
    res.json({ content })
  } catch {
    res.status(404).json({ error: 'File not found' })
  }
})

app.put('/api/skills/:name/file', async (req, res) => {
  const { name } = req.params
  const filePath  = req.query.path
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid skill name' })
  if (!filePath)              return res.status(400).json({ error: 'Missing path query param' })
  const found = await findSkillPath(name)
  if (!found?.isFolder)      return res.status(404).json({ error: 'Skill folder not found' })
  const fullPath = path.resolve(path.join(SKILLS_DIR, name, filePath))
  const skillDir = path.resolve(path.join(SKILLS_DIR, name))
  if (!fullPath.startsWith(skillDir + path.sep)) return res.status(400).json({ error: 'Invalid file path' })
  try {
    await fs.writeFile(fullPath, req.body.content ?? '', 'utf8')
    if (filePath === 'SKILL.md') { invalidateRegistry(); registry = await loadRegistry() }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/skills', async (req, res) => {
  const { name, content, files } = req.body
  if (!name || !SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid or missing skill name' })
  if (await findSkillPath(name)) return res.status(409).json({ error: `Skill "${name}" already exists` })
  try {
    const skillDir = path.join(SKILLS_DIR, name)
    await fs.mkdir(skillDir, { recursive: true })
    if (files && typeof files === 'object' && Object.keys(files).length > 0) {
      for (const [relPath, fileContent] of Object.entries(files)) {
        const fullPath = path.join(skillDir, relPath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, fileContent, 'utf8')
      }
    } else {
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), content ?? '', 'utf8')
    }
    invalidateRegistry()
    registry = await loadRegistry()
    res.status(201).json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/skills/:name', async (req, res) => {
  const { name } = req.params
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid skill name' })
  const found = await findSkillPath(name)
  if (!found) return res.status(404).json({ error: 'Skill not found' })
  try {
    await fs.writeFile(found.filePath, req.body.content ?? '', 'utf8')
    invalidateRegistry()
    registry = await loadRegistry()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/skills/:name', async (req, res) => {
  const { name } = req.params
  if (!SAFE_NAME.test(name)) return res.status(400).json({ error: 'Invalid skill name' })
  const found = await findSkillPath(name)
  if (!found) return res.status(404).json({ error: 'Skill not found' })
  try {
    if (found.isFolder) {
      await fs.rm(path.join(SKILLS_DIR, name), { recursive: true, force: true })
    } else {
      await fs.unlink(found.filePath)
    }
    invalidateRegistry()
    registry = await loadRegistry()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Documentation endpoints ──────────────────────────────────────────────────

app.get('/api/docs', async (req, res) => {
  try {
    await fs.mkdir(DOCS_DIR, { recursive: true })
    const files = await listFilesRecursive(DOCS_DIR)
    res.json({ files: files.map(f => f.replace(/\\/g, '/')) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/docs/file', async (req, res) => {
  const filePath = req.query.path
  if (!filePath) return res.status(400).json({ error: 'path is required' })
  const docsBase = path.resolve(DOCS_DIR)
  const fullPath = path.resolve(path.join(DOCS_DIR, filePath))
  if (!fullPath.startsWith(docsBase + path.sep)) return res.status(400).json({ error: 'Invalid path' })
  try {
    const content = await fs.readFile(fullPath, 'utf8')
    res.json({ content, path: filePath })
  } catch {
    res.status(404).json({ error: 'File not found' })
  }
})

app.post('/api/restart', async (req, res) => {
  res.json({ ok: true, message: 'Server restarting…' })
  await fs.writeFile(path.join(__dirname, 'restart.trigger'), Date.now().toString(), 'utf8')
})

app.listen(3001, () => log.info('server', 'BlueAgent API running on :3001'))
