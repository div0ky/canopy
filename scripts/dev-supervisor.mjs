import { fork, spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { HotReloadSupervisor } from '@canopy/arbor/hot-reload'
import { installAuthSchema } from '@canopy/auth-postgres'
import { ConsoleLogSink, Logger } from '@canopy/core'
import { installPersistenceSchema } from '@canopy/postgres-drizzle'
import { installQueueSchema } from '@canopy/queue-pg-boss'
import { installUndergrowthSchema } from '@canopy/undergrowth'

const workspace = process.cwd()
const applicationRoot = path.join(workspace, 'examples/persistence-app')
const connectionString =
  process.env.DATABASE_CONNECTION_STRING ?? 'postgresql://canopy:canopy@127.0.0.1:54329/canopy'
const logger = new Logger({
  sink: new ConsoleLogSink({ format: 'pretty', color: process.env.NO_COLOR === undefined }),
  level: process.env.CANOPY_LOG_LEVEL ?? 'info',
}).channel('hmr')

await installPersistenceSchema(connectionString)
await installAuthSchema(connectionString)
await installQueueSchema(connectionString)
await installUndergrowthSchema(connectionString)

const packageEntries = await readdir(path.join(workspace, 'packages'), { withFileTypes: true })
const watchPaths = [
  path.join(applicationRoot, 'src'),
  ...packageEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workspace, 'packages', entry.name, 'src')),
]

const supervisor = await HotReloadSupervisor.start({
  watchPaths,
  build: buildDevelopmentApplication,
  start: startDevelopmentServer,
  onWatching: () => logger.info('Watching for application changes'),
  onChange: (changedPath, event) =>
    logger.debug('Source change detected', { path: changedPath, event }),
  onReloaded: () => logger.info('Hot reload complete'),
  onError: (error, phase) =>
    logger.error(
      phase === 'build'
        ? 'Hot reload build failed; the last good server remains active'
        : `Hot reload ${phase} failed`,
      error,
    ),
})

let stopping = false
const stop = async (signal) => {
  if (stopping) return
  stopping = true
  logger.info('Stopping development supervisor', { signal })
  await supervisor.stop()
}
process.once('SIGINT', () => void stop('SIGINT'))
process.once('SIGTERM', () => void stop('SIGTERM'))

async function buildDevelopmentApplication() {
  const code = await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
    'exec',
    'tsc',
    '-b',
    '--pretty',
    'false',
  ])
  if (code !== 0) throw new Error(`TypeScript build failed with exit code ${code}.`)
  const compileCode = await run(process.execPath, [path.join(workspace, 'scripts/dev-build.mjs')])
  if (compileCode !== 0) {
    throw new Error(`Canopy manifest compilation failed with exit code ${compileCode}.`)
  }
}

async function startDevelopmentServer() {
  const child = fork(path.join(workspace, 'scripts/dev-server.mjs'), [], {
    cwd: workspace,
    env: { ...process.env, DATABASE_CONNECTION_STRING: connectionString },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('Development server readiness timed out.')),
      30_000,
    )
    timeout.unref()
    const onMessage = (message) => {
      if (message?.type === 'ready') finish()
    }
    const onExit = (code, signal) =>
      finish(
        new Error(`Development server exited before readiness (${code ?? signal ?? 'unknown'}).`),
      )
    const onError = (error) => finish(error)
    const finish = (error) => {
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error) reject(error)
      else resolve()
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
  return {
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
      timer.unref()
      try {
        await exited
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: workspace, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}
