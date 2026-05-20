import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR  = path.resolve(path.join(__dirname, '..', 'documentation'))

export const schema = {
  name: 'file_write',
  description:
    'Write or overwrite a file in the documentation folder (documentation/) or any of its sub-folders. ' +
    'Use this to create new documents, update existing ones, or save generated content such as ' +
    'reports, summaries, templates, or reference material. ' +
    'Parent directories are created automatically if they do not exist.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'File path relative to the documentation/ folder ' +
          '(e.g. "report.md", "guides/setup.md", "templates/incident.json"). ' +
          'Use forward slashes as separators.',
      },
      content: {
        type: 'string',
        description: 'The text content to write to the file.',
      },
    },
    required: ['path', 'content'],
  },
}

export async function invoke({ path: filePath, content }) {
  if (!filePath) throw new Error('path is required')
  if (content === undefined || content === null) throw new Error('content is required')

  const fullPath = path.resolve(path.join(DOCS_DIR, filePath))

  // Prevent traversal outside documentation/
  if (!fullPath.startsWith(DOCS_DIR + path.sep) && fullPath !== DOCS_DIR) {
    throw new Error(`Access denied: "${filePath}" is outside the documentation directory`)
  }

  // Create parent directories if needed
  await fs.mkdir(path.dirname(fullPath), { recursive: true })

  const existed = await fs.access(fullPath).then(() => true).catch(() => false)
  await fs.writeFile(fullPath, content, 'utf8')

  return {
    path:    `documentation/${filePath}`,
    action:  existed ? 'updated' : 'created',
    bytes:   Buffer.byteLength(content, 'utf8'),
    lines:   content.split('\n').length,
  }
}
