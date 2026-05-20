import { AzureChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { log } from './logger.js'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_DIR  = path.join(__dirname, 'tools')
const MEMORY_DIR = path.join(__dirname, 'memory')

const BASE_MODEL = {
  azureOpenAIEndpoint:          process.env.AZURE_OPENAI_ENDPOINT,
  azureOpenAIApiKey:            process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiVersion:        process.env.AZURE_OPENAI_API_VERSION,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_CHAT || process.env.AZURE_OPENAI_DEPLOYMENT,
}

// ── Tool invocation ──────────────────────────────────────────────────────
async function fileExists(p) {
  try { await fs.access(p); return true } catch { return false }
}

async function invokeJsTool(name, args) {
  const mod = await import(pathToFileURL(path.join(TOOLS_DIR, `${name}.js`)).href)
  return mod.invoke(args)
}

function invokePythonTool(name, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [path.join(TOOLS_DIR, `${name}.py`)], { env: process.env })
    proc.stdin.write(JSON.stringify(args))
    proc.stdin.end()
    let out = '', err = ''
    proc.stdout.on('data', d => out += d)
    proc.stderr.on('data', d => err += d)
    proc.on('close', code => {
      let parsed = null
      try { parsed = JSON.parse(out) } catch {}
      if (code !== 0) {
        const detail = parsed?.error || err.trim() || out.trim() || `exit code ${code}`
        return reject(new Error(`Tool ${name} failed: ${detail}`))
      }
      if (parsed === null) return reject(new Error(`Tool ${name} invalid JSON: ${out}`))
      resolve(parsed)
    })
  })
}

export async function invokeTool(name, args) {
  if (await fileExists(path.join(TOOLS_DIR, `${name}.js`))) return invokeJsTool(name, args)
  if (await fileExists(path.join(TOOLS_DIR, `${name}.py`))) return invokePythonTool(name, args)
  throw new Error(`Tool not found: ${name}`)
}

// ── Tool schema loading ──────────────────────────────────────────────────
function toOpenAITool(raw) {
  // Azure OpenAI requires { type: "function", function: { name, description, parameters } }
  if (raw.type === 'function') return raw
  return { type: 'function', function: { name: raw.name, description: raw.description, parameters: raw.parameters } }
}

async function loadToolSchemas(names) {
  const schemas = []
  for (const name of names) {
    const jsPath     = path.join(TOOLS_DIR, `${name}.js`)
    const schemaPath = path.join(TOOLS_DIR, `${name}.schema.json`)
    if (await fileExists(jsPath)) {
      try {
        const mod = await import(pathToFileURL(jsPath).href)
        if (mod.schema) schemas.push(toOpenAITool(mod.schema))
      } catch (e) { log.warn('tools', `Failed to load schema for ${name}`, e.message) }
    } else if (await fileExists(schemaPath)) {
      try {
        schemas.push(toOpenAITool(JSON.parse(await fs.readFile(schemaPath, 'utf8'))))
      } catch (e) { log.warn('tools', `Failed to load schema for ${name}`, e.message) }
    }
  }
  return schemas
}

// ── Memory ───────────────────────────────────────────────────────────────
async function loadMemory(agentName) {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true })
    const files = (await fs.readdir(MEMORY_DIR))
      .filter(f => f.startsWith(`${agentName}_`) && f.endsWith('.md'))
      .sort()

    if (!files.length) return ''

    const recent   = files.slice(-5)
    const contents = await Promise.all(
      recent.map(f => fs.readFile(path.join(MEMORY_DIR, f), 'utf8'))
    )
    return `## Lessons Learned\n\n${contents.join('\n\n---\n\n')}`
  } catch {
    return ''
  }
}

function truncate(s, n) {
  const str = String(s ?? '')
  return str.length > n ? `${str.slice(0, n)}…[truncated]` : str
}

function formatToolAttempts(toolAttempts) {
  if (!toolAttempts?.length) return '_(no tool calls)_'
  return toolAttempts.map(t => {
    const args = truncate(JSON.stringify(t.args), 800)
    return `- \`${t.name}(${args})\` → ${t.ok ? 'OK' : `ERROR: ${t.error}`}`
  }).join('\n')
}

async function writeMemory(agentName, query, history, finalScore, passed, lesson) {
  await fs.mkdir(MEMORY_DIR, { recursive: true })
  const ts       = new Date().toISOString()
  const safeName = ts.replace(/[:.]/g, '-')
  const filePath = path.join(MEMORY_DIR, `${agentName}_${safeName}.md`)

  const failed  = history.filter(h => !h.passed)
  const passing = history.find(h => h.passed)

  const attemptDetail = history.map(h => [
    `### Attempt ${h.attempt} — score ${h.score}/10 ${h.passed ? 'PASS' : 'FAIL'}`,
    `**Evaluator:** ${h.feedback}`,
    `**Tool calls:**`,
    formatToolAttempts(h.toolAttempts),
  ].join('\n')).join('\n\n')

  const lessonBlock = lesson
    ? [
        `**Rule:** ${lesson.rule}`,
        ``,
        `**Avoid:** ${lesson.avoid}`,
        ``,
        `**Next time:** ${lesson.next_time}`,
      ].join('\n')
    : (passed
        ? `After ${failed.length} failure(s), the winning approach was: ${passing?.strengths ?? '(not captured)'}`
        : `Despite ${history.length} attempts, threshold was not reached. Avoid: ${failed.map(h => h.feedback).slice(0, 3).join('; ')}`)

  const content = [
    `---`,
    `agent: ${agentName}`,
    `timestamp: ${ts}`,
    `query: "${query.slice(0, 120).replace(/"/g, "'")}"`,
    `attempts: ${history.length}`,
    `final_score: ${finalScore}`,
    `outcome: ${passed ? 'PASSED_AFTER_RETRIES' : 'FAILED_ALL_RETRIES'}`,
    `---`,
    '',
    `## Key Lesson`,
    lessonBlock,
    '',
    passed
      ? `## Failed Attempts (${failed.length})`
      : `## ⚠ Warning: All ${history.length} Attempts Failed — Do NOT Repeat These Approaches`,
    '',
    attemptDetail,
  ].join('\n')

  await fs.writeFile(filePath, content, 'utf8')
  log.info('memory', `Written: ${path.basename(filePath)}`)

  // Cap lesson files at 10 per agent — delete oldest beyond that
  const allFiles = (await fs.readdir(MEMORY_DIR))
    .filter(f => f.startsWith(`${agentName}_`) && f.endsWith('.md'))
    .sort()
  if (allFiles.length > 10) {
    const toDelete = allFiles.slice(0, allFiles.length - 10)
    await Promise.all(toDelete.map(f => fs.unlink(path.join(MEMORY_DIR, f))))
    log.info('memory', `Pruned ${toDelete.length} old lesson(s) for ${agentName}`)
  }
}

// ── Lesson synthesis ─────────────────────────────────────────────────────
const LessonSchema = z.object({
  rule:      z.string().describe('The single concrete instruction the agent should follow for similar future requests. Name specific tools, tables, columns, query patterns, or workflows.'),
  avoid:     z.string().describe('What specifically failed and must not be repeated. Quote the failed query, table, column, or method.'),
  next_time: z.string().describe('The concrete alternative — name the right tool, table, query pattern, or workflow. Include an example if useful.'),
})

async function synthesizeLesson(agentConfig, query, history, passed) {
  const model = new AzureChatOpenAI({ ...BASE_MODEL, temperature: 0.2 })
    .withStructuredOutput(LessonSchema)

  const attemptSummary = history.map(h => {
    const toolLog = (h.toolAttempts ?? []).map(t => {
      const args = truncate(JSON.stringify(t.args), 800)
      return `    - ${t.name}(${args}) → ${t.ok ? 'OK' : `ERROR: ${t.error}`}`
    }).join('\n')
    return [
      `Attempt ${h.attempt} — score ${h.score}/10 ${h.passed ? 'PASS' : 'FAIL'}`,
      `  Evaluator feedback: ${h.feedback}`,
      toolLog ? `  Tool calls:\n${toolLog}` : `  Tool calls: (none)`,
      `  Final reply: ${truncate(h.reply, 600)}`,
    ].join('\n')
  }).join('\n\n')

  const skillContext = truncate(agentConfig._systemPrompt ?? agentConfig.system_prompt ?? '', 4000)

  const system = new SystemMessage(
    `You write post-mortem lessons for an AI agent so it improves on similar future requests. ` +
    `Lessons MUST be ACTIONABLE and SPECIFIC — name exact tools, tables, columns, query patterns, or workflows. ` +
    `Do not describe what went wrong in prose; prescribe what to DO and what to AVOID. ` +
    `Use the agent's domain knowledge (its skills/system prompt below) to ground your recommendations in real schemas and APIs — do not invent column names or query syntax.\n\n` +
    `Agent: ${agentConfig.display_name ?? agentConfig.name} — ${agentConfig.description ?? ''}\n` +
    `Available tools: ${(agentConfig.tools ?? []).join(', ') || '(none)'}\n\n` +
    `--- AGENT DOMAIN KNOWLEDGE (skills + mission) ---\n${skillContext}\n--- END DOMAIN KNOWLEDGE ---`
  )
  const human = new HumanMessage(
    `User query: ${query}\n\n` +
    `Outcome: ${passed ? 'PASSED after retries' : 'FAILED all retries'}\n\n` +
    `Attempts:\n${attemptSummary}\n\n` +
    `Produce three concise fields:\n` +
    `- rule: the single concrete instruction for next time (1 sentence, name specifics)\n` +
    `- avoid: the failed approach + why it broke (quote the bad query/table/column)\n` +
    `- next_time: the concrete alternative (name the right tool/table/query pattern, with example if useful)\n\n` +
    `If a tool error message looks empty or generic, do NOT guess the cause — just say the error was opaque and recommend a different approach grounded in the domain knowledge above.`
  )

  log.llmRequest(`${agentConfig.name}/lesson`, 'synthesize', [system, human])
  const result = await model.invoke([system, human])
  log.llmResponse(`${agentConfig.name}/lesson`, 'synthesize', {
    content: `rule="${result.rule}" | avoid="${result.avoid}" | next="${result.next_time}"`,
    tool_calls: [],
  })
  return result
}

async function persistMemory(agentConfig, userQuery, history, finalScore, passed) {
  let lesson = null
  try {
    lesson = await synthesizeLesson(agentConfig, userQuery, history, passed)
  } catch (err) {
    log.warn(`agent:${agentConfig.name}`, `Lesson synthesis failed, falling back to prose: ${err.message}`)
  }
  await writeMemory(agentConfig.name, userQuery, history, finalScore, passed, lesson)
}

// ── Evaluator LLM call ───────────────────────────────────────────────────
const EvalSchema = z.object({
  score:     z.number().min(0).max(10),
  passed:    z.boolean(),
  feedback:  z.string().describe('Actionable improvement points if not passing, else "Approved"'),
  strengths: z.string().optional().describe('What worked well — only needed on passing attempts'),
  critique:  z.string().optional().describe('Specific sub-criteria that fell short — one bullet per criterion — only on failing attempts'),
})

async function evaluate(agentConfig, userQuery, reply) {
  const threshold = agentConfig.evaluator?.threshold ?? 7
  const model = new AzureChatOpenAI({ ...BASE_MODEL, temperature: 0.1 })
    .withStructuredOutput(EvalSchema)

  const evalMessages = [
    new SystemMessage(
      `Evaluate ${agentConfig.display_name} output. Pass threshold: ${threshold}/10.\n\n` +
      (agentConfig.evaluator?.criteria ?? 'Score 1-10 for accuracy, relevance, and quality.') +
      `\n\nIf the response does not pass, populate 'critique' with one bullet per named criterion showing the sub-score and what specifically fell short.`
    ),
    new HumanMessage(`Query: ${userQuery}\n\nResponse:\n${reply}`),
  ]
  log.llmRequest(`${agentConfig.name}/eval`, 'evaluator', evalMessages)
  const result = await model.invoke(evalMessages)
  log.llmResponse(`${agentConfig.name}/eval`, 'evaluator', {
    content: `score=${result.score} passed=${result.passed} | ${result.feedback}`,
    tool_calls: [],
  })
  return result
}

// ── Core GOAL/EXPECTED/EVAL loop ─────────────────────────────────────────
async function runLoop(agentConfig, lcMessages, userQuery) {
  const threshold  = agentConfig.evaluator?.threshold ?? 7
  const maxRetries = agentConfig.evaluator?.max_retries ?? 3
  const baseModel  = new AzureChatOpenAI({
    ...BASE_MODEL,
    temperature: agentConfig.model?.temperature ?? 0.7,
  })

  const toolSchemas = await loadToolSchemas(agentConfig.tools ?? [])
  const model       = toolSchemas.length ? baseModel.bindTools(toolSchemas) : baseModel

  const history  = []
  let prevScore    = 0
  let prevFeedback = ''
  let prevCritique = ''

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // On retries, inject the evaluator's feedback into the system prompt
    const sysContent = attempt === 1
      ? lcMessages[0].content
      : lcMessages[0].content +
        `\n\n## REVISION REQUIRED — Previous Attempt Score: ${prevScore}/10\n` +
        `${prevFeedback}\n` +
        (prevCritique ? `\n### Sub-criteria breakdown:\n${prevCritique}\n` : '') +
        `Rewrite your response specifically addressing the above feedback.`

    let messages = [
      new SystemMessage(sysContent),
      ...lcMessages.slice(1),
    ]

    // Agentic tool-use loop
    log.llmRequest(agentConfig.name, `attempt ${attempt}/${maxRetries}`, messages, toolSchemas.length)
    let response = await model.invoke(messages)
    log.llmResponse(agentConfig.name, `attempt ${attempt}/${maxRetries}`, response)

    const toolAttempts = []
    let toolRound = 0
    while (response.tool_calls?.length) {
      toolRound++
      messages = [...messages, response]
      for (const tc of response.tool_calls) {
        log.toolCall(agentConfig.name, tc.name, tc.args)
        let content, ok = true, error = null
        try {
          const result = await invokeTool(tc.name, tc.args)
          content = JSON.stringify(result)
          log.toolResult(agentConfig.name, tc.name, result)
        } catch (err) {
          content = JSON.stringify({ error: err.message })
          log.toolResult(agentConfig.name, tc.name, err.message, true)
          ok = false
          error = err.message
        }
        toolAttempts.push({ name: tc.name, args: tc.args, ok, error })
        messages.push(new ToolMessage({ tool_call_id: tc.id, content, name: tc.name }))
      }
      log.llmRequest(agentConfig.name, `attempt ${attempt} tool-round ${toolRound}`, messages, toolSchemas.length)
      response = await model.invoke(messages)
      log.llmResponse(agentConfig.name, `attempt ${attempt} tool-round ${toolRound}`, response)
    }

    const reply      = response.content
    const evalResult = await evaluate(agentConfig, userQuery, reply)

    history.push({ attempt, ...evalResult, reply, toolAttempts })
    log.evalResult(
      agentConfig.name, attempt, evalResult.score, threshold,
      evalResult.passed, evalResult.feedback, evalResult.critique
    )

    if (evalResult.score >= threshold) {
      if (history.length > 1) {
        await persistMemory(agentConfig, userQuery, history, evalResult.score, true)
      }
      return reply
    }

    prevScore    = evalResult.score
    prevFeedback = evalResult.feedback
    prevCritique = evalResult.critique ?? ''
  }

  // All retries exhausted — write warning memory and surface a clear failure message
  const best = history.reduce((a, b) => a.score > b.score ? a : b)
  await persistMemory(agentConfig, userQuery, history, best.score, false)
  log.warn(`agent:${agentConfig.name}`, `Max retries reached. Best score=${best.score}/${threshold}`)
  const label = agentConfig.display_name ?? agentConfig.name
  throw new Error(
    `${label} was unable to complete this task. ` +
    `After ${maxRetries} attempt${maxRetries === 1 ? '' : 's'}, the response did not meet ` +
    `the quality threshold (best score: ${best.score}/${threshold}). ` +
    `Please try rephrasing your request or providing more detail.`
  )
}

// ── Build system prompt with mission/expected/memory ──────────────────────
async function buildSystemPrompt(agentConfig, context) {
  let prompt = agentConfig._systemPrompt || agentConfig.system_prompt || ''

  if (agentConfig.mission) {
    prompt += `\n\n## Your Mission\n${agentConfig.mission.trim()}`
  }
  if (agentConfig.expected) {
    prompt += `\n\n## Expected Output\n${agentConfig.expected.trim()}`
  }

  const memory = await loadMemory(agentConfig.name)
  if (memory) prompt += `\n\n${memory}`

  if (context) prompt += `\n\n## Context from Previous Agent\n${context}`

  return prompt
}

// ── Public API ────────────────────────────────────────────────────────────

// Standard call: full chat message history [{role, text}]
export async function runAgent(agentConfig, messages, context = null) {
  const userQuery  = messages.at(-1)?.text ?? ''
  log.agentStart(agentConfig.display_name ?? agentConfig.name, userQuery)
  if (agentConfig.skills?.length)  log.info(`agent:${agentConfig.name}`, `skills: ${agentConfig.skills.join(', ')}`)
  if (agentConfig.tools?.length)   log.info(`agent:${agentConfig.name}`, `tools:  ${agentConfig.tools.join(', ')}`)
  const sysPrompt  = await buildSystemPrompt(agentConfig, context)

  const lcMessages = [
    new SystemMessage(sysPrompt),
    ...messages.map(m => {
      if (m.role === 'ai') return new AIMessage(m.text)
      if (m.images?.length) {
        return new HumanMessage({
          content: [
            { type: 'text', text: m.text },
            ...m.images.map(url => ({ type: 'image_url', image_url: { url } })),
          ],
        })
      }
      return new HumanMessage(m.text)
    }),
  ]

  return runLoop(agentConfig, lcMessages, userQuery)
}

// Pipeline call: single query string (for LangGraph nodes)
export async function runPipelineAgent(agentConfig, query, context = null) {
  return runAgent(agentConfig, [{ role: 'user', text: query }], context)
}
