import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = path.join(__dirname, '..', 'skills')

export const schema = {
  name: 'read_skill_file',
  description:
    'Read a reference file, workflow guide, or sample query from a skill folder. ' +
    'Use this whenever skill documentation refers you to a specific file (e.g. "references/operators.md", ' +
    '"workflows/WriteQuery.md", "samples/sentinel/failed-sign-ins.kql"). ' +
    'Read the relevant file before generating a response that depends on its content.',
  parameters: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'Skill name as shown in the skill frontmatter (e.g. "kql")',
      },
      path: {
        type: 'string',
        description:
          'File path relative to the skill folder ' +
          '(e.g. "references/operators.md", "workflows/WriteQuery.md", ' +
          '"samples/sentinel/failed-sign-ins-by-location.kql")',
      },
    },
    required: ['skill', 'path'],
  },
}

export async function invoke({ skill, path: filePath }) {
  if (!skill || !filePath) throw new Error('Both skill and path are required')

  const fullPath = path.resolve(path.join(SKILLS_DIR, skill, filePath))
  const skillDir = path.resolve(SKILLS_DIR)

  // Prevent traversal outside the skills directory
  if (!fullPath.startsWith(skillDir + path.sep)) {
    throw new Error(`Access denied: "${filePath}" is outside the skills directory`)
  }

  try {
    const content = await fs.readFile(fullPath, 'utf8')
    return {
      path:    `skills/${skill}/${filePath}`,
      content,
      lines:   content.split('\n').length,
    }
  } catch {
    throw new Error(`File not found: skills/${skill}/${filePath}`)
  }
}
