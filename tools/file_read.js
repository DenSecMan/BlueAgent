import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR  = path.resolve(path.join(__dirname, '..', 'documentation'))

export const schema = {
  name: 'file_read',
  description:
    'Read a file from the documentation folder (documentation/) or any of its sub-folders. ' +
    'Use this to retrieve reference material, guides, templates, or any document ' +
    'stored in the documentation directory. Supports plain text, markdown, JSON, and similar formats.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'File path relative to the documentation/ folder ' +
          '(e.g. "architecture.md", "guides/onboarding.md", "templates/report.json"). ' +
          'Use forward slashes as separators.',
      },
    },
    required: ['path'],
  },
}

export async function invoke({ path: filePath }) {
  if (!filePath) throw new Error('path is required')

  const fullPath = path.resolve(path.join(DOCS_DIR, filePath))

  // Prevent traversal outside documentation/
  if (!fullPath.startsWith(DOCS_DIR + path.sep) && fullPath !== DOCS_DIR) {
    throw new Error(`Access denied: "${filePath}" is outside the documentation directory`)
  }

  let stat
  try {
    stat = await fs.stat(fullPath)
  } catch {
    throw new Error(`File not found: documentation/${filePath}`)
  }

  if (stat.isDirectory()) {
    // Return a directory listing instead of erroring
    const entries = await fs.readdir(fullPath, { withFileTypes: true })
    const listing = entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name))
    return {
      path:    `documentation/${filePath}`,
      type:    'directory',
      entries: listing,
    }
  }

  const content = await fs.readFile(fullPath, 'utf8')
  return {
    path:    `documentation/${filePath}`,
    type:    'file',
    content,
    lines:   content.split('\n').length,
    bytes:   Buffer.byteLength(content, 'utf8'),
  }
}
