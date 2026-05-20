import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'
import { log } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENTS_DIR = path.join(__dirname, 'agents')
const SKILLS_DIR = path.join(__dirname, 'skills')

let _cache = null

async function loadSkill(name) {
  // Folder format: skills/{name}/SKILL.md
  try { return await fs.readFile(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8') } catch {}
  // Flat format fallback: skills/{name}.md
  try { return await fs.readFile(path.join(SKILLS_DIR, `${name}.md`), 'utf8') } catch {}
  log.warn('loader', `Skill not found: ${name}`)
  return ''
}

export async function loadRegistry() {
  if (_cache) return _cache

  const files = (await fs.readdir(AGENTS_DIR)).filter(f => f.endsWith('.yaml'))

  const agents = await Promise.all(files.map(async (file) => {
    const raw    = await fs.readFile(path.join(AGENTS_DIR, file), 'utf8')
    const config = yaml.load(raw)

    // Merge skill text blocks into the system prompt (formatting is always included)
    const agentSkills  = config.skills ?? []
    const allSkills    = agentSkills.includes('formatting') ? agentSkills : [...agentSkills, 'formatting']
    const skillBlocks  = await Promise.all(allSkills.map(loadSkill))
    const skillText    = skillBlocks.filter(Boolean).join('\n\n')
    config._systemPrompt = skillText
      ? `${config.system_prompt ?? ''}\n\n${skillText}`
      : (config.system_prompt ?? '')

    // Auto-inject read_skill_file for any agent that has skills with folder structure
    if (agentSkills.length > 0) {
      const hasFolderSkill = await Promise.all(
        agentSkills.map(s => fs.access(path.join(SKILLS_DIR, s, 'SKILL.md')).then(() => true).catch(() => false))
      )
      if (hasFolderSkill.some(Boolean)) {
        const tools = config.tools ?? []
        if (!tools.includes('read_skill_file')) {
          config.tools = [...tools, 'read_skill_file']
        }
      }
    }

    return config
  }))

  _cache = agents
  log.info('loader', `Registry built: ${agents.map(a => `${a.name}(skills:${(a.skills??[]).length} tools:${(a.tools??[]).length})`).join(', ')}`)
  return agents
}

export async function getAgent(name) {
  const registry = await loadRegistry()
  return registry.find(a => a.name === name) ?? null
}

// Call this to force a reload after editing YAML/skill files
export function invalidateRegistry() {
  _cache = null
}
