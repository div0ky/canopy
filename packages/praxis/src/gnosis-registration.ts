import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { PraxisCommandError } from './errors.js'

export const GNOSIS_AGENTS = ['codex', 'claude', 'cursor', 'vscode'] as const
export type GnosisAgent = (typeof GNOSIS_AGENTS)[number]

const serverCommand = 'node'
const serverArguments = ['./node_modules/@doxajs/praxis/dist/bin.js', 'mcp'] as const

export async function installGnosisRegistration(
  cwd: string,
  agents: readonly GnosisAgent[] = GNOSIS_AGENTS,
): Promise<readonly string[]> {
  const files: string[] = []
  for (const agent of agents) {
    const file = await registerAgent(cwd, agent)
    files.push(path.relative(cwd, file))
  }
  return files
}

export function parseGnosisAgents(args: readonly string[]): readonly GnosisAgent[] {
  if (args.length === 0) return GNOSIS_AGENTS
  const selected = new Set<GnosisAgent>()
  for (const argument of args) {
    if (!argument.startsWith('--agent=')) {
      throw new PraxisCommandError(`Unknown gnosis:install option ${argument}.`)
    }
    const values = argument.slice('--agent='.length).split(',')
    for (const value of values) {
      if (value === 'all') {
        for (const agent of GNOSIS_AGENTS) selected.add(agent)
        continue
      }
      if (!isGnosisAgent(value)) {
        throw new PraxisCommandError(
          `Unsupported Gnosis agent ${value || '(empty)'}. Choose codex, claude, cursor, vscode, or all.`,
        )
      }
      selected.add(value)
    }
  }
  return GNOSIS_AGENTS.filter((agent) => selected.has(agent))
}

async function registerAgent(cwd: string, agent: GnosisAgent): Promise<string> {
  if (agent === 'codex') return registerCodex(cwd)
  if (agent === 'claude') {
    return registerJson(cwd, '.mcp.json', 'mcpServers', {
      command: serverCommand,
      args: serverArguments,
      env: {},
    })
  }
  if (agent === 'cursor') {
    return registerJson(cwd, '.cursor/mcp.json', 'mcpServers', {
      command: serverCommand,
      args: serverArguments,
      env: {},
    })
  }
  return registerJson(cwd, '.vscode/mcp.json', 'servers', {
    type: 'stdio',
    command: serverCommand,
    args: serverArguments,
    cwd: '${workspaceFolder}',
  })
}

async function registerCodex(cwd: string): Promise<string> {
  const file = path.join(cwd, '.codex/config.toml')
  const header = '[mcp_servers.gnosis]'
  const block = [
    header,
    `command = ${JSON.stringify(serverCommand)}`,
    `args = ${JSON.stringify(serverArguments)}`,
    'cwd = ".."',
    'startup_timeout_sec = 120',
  ].join('\n')
  const existing = await readOptional(file)
  let content: string
  if (existing === undefined || existing.trim().length === 0) {
    content = `${block}\n`
  } else {
    const lines = existing.replace(/\r\n/g, '\n').split('\n')
    const start = lines.findIndex((line) => line.trim() === header)
    if (start === -1) {
      if (/^\s*mcp_servers\.gnosis\b/m.test(existing)) {
        throw new PraxisCommandError(
          `${path.relative(cwd, file)} declares Gnosis with unsupported dotted TOML keys. Convert it to ${header} before reinstalling.`,
        )
      }
      content = `${existing.trimEnd()}\n\n${block}\n`
    } else {
      let end = start + 1
      while (end < lines.length) {
        const line = lines[end]!.trim()
        if (/^\[\[?.*\]\]?$/.test(line) && !line.startsWith('[mcp_servers.gnosis.')) break
        end += 1
      }
      lines.splice(start, end - start, ...block.split('\n'))
      content = `${lines.join('\n').trimEnd()}\n`
    }
  }
  await writeChanged(file, content)
  return file
}

async function registerJson(
  cwd: string,
  relative: string,
  section: 'mcpServers' | 'servers',
  server: Readonly<Record<string, unknown>>,
): Promise<string> {
  const file = path.join(cwd, relative)
  const existing = await readOptional(file)
  let document: Record<string, unknown> = {}
  if (existing !== undefined && existing.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (!isRecord(parsed)) throw new Error('root must be an object')
      document = parsed
    } catch (error) {
      throw new PraxisCommandError(`Cannot update invalid MCP configuration ${relative}.`, {
        cause: error,
      })
    }
  }
  const current = document[section]
  if (current !== undefined && !isRecord(current)) {
    throw new PraxisCommandError(`${relative} field ${section} must be an object.`)
  }
  document[section] = { ...(current ?? {}), gnosis: server }
  await writeChanged(file, `${JSON.stringify(document, null, 2)}\n`)
  return file
}

async function writeChanged(file: string, content: string): Promise<void> {
  if ((await readOptional(file)) === content) return
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function isGnosisAgent(value: string): value is GnosisAgent {
  return (GNOSIS_AGENTS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
