import path from 'node:path'

import { compileApplication } from '@canopy/compiler'
import { installAuthSchema } from '@canopy/auth-postgres'
import { HonoHttpHost } from '@canopy/http-hono'
import { installPersistenceSchema } from '@canopy/postgres-drizzle'
import { installQueueSchema } from '@canopy/queue-pg-boss'
import { Canopy } from '@canopy/runtime'

import { Application } from '../examples/persistence-app/dist/application.js'

const workspace = process.cwd()
const applicationRoot = path.join(workspace, 'examples/persistence-app')
const artifactsDirectory = path.join(workspace, '.canopy/dev')
const connectionString = process.env.DATABASE_CONNECTION_STRING
  ?? 'postgresql://canopy:canopy@127.0.0.1:54329/canopy'
const port = numberFromEnvironment('PORT', 3000)
const hostname = process.env.HOST ?? '127.0.0.1'

await installPersistenceSchema(connectionString)
await installAuthSchema(connectionString)
await installQueueSchema(connectionString)
await compileApplication({
  tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
  applicationFile: path.join(applicationRoot, 'src/application.ts'),
  sourceRoot: path.join(applicationRoot, 'src'),
  outputRoot: path.join(applicationRoot, 'dist'),
  artifactsDirectory,
})

const runtime = await Canopy.boot(Application, {
  artifactsDirectory,
  dotenvPath: false,
  environment: {
    ...process.env,
    DATABASE_CONNECTION_STRING: connectionString,
  },
  logging: { format: 'pretty', color: process.env.NO_COLOR === undefined },
})

let host
try {
  host = await HonoHttpHost.listen(runtime, { port, hostname })
} catch (error) {
  await runtime.shutdown().catch(() => undefined)
  throw error
}

runtime.logger.channel('lifecycle').info('HTTP server ready', {
  url: host.url.toString(),
  routes: runtime.manifest.routes.length,
})
runtime.logger.channel('http').debug('Routes mounted', {
  routes: runtime.manifest.routes.map((route) => `${route.method} ${route.path}`),
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  runtime.logger.channel('lifecycle').info('Process signal received', { signal })
  try {
    await host.shutdown()
    process.exitCode = 0
  } catch (error) {
    runtime.logger.channel('lifecycle').fatal('Host shutdown failed', error)
    process.exitCode = 1
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

function numberFromEnvironment(name, fallback) {
  const value = process.env[name]
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 0 and 65535.`)
  }
  return parsed
}
