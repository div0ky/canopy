import path from 'node:path'

import { HonoHttpHost } from '@doxajs/http-hono'
import { Doxa } from '@doxajs/runtime'

import { Application } from '../examples/persistence-app/dist/application.js'

const workspace = process.cwd()
const artifactsDirectory = path.join(workspace, '.doxa/dev')
const connectionString =
  process.env.DATABASE_CONNECTION_STRING ?? 'postgresql://doxa:doxa@127.0.0.1:54329/doxa'
const port = numberFromEnvironment('PORT', 3000)
const hostname = process.env.HOST ?? '127.0.0.1'

const runtime = await Doxa.boot(Application, {
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
process.send?.({ type: 'ready', url: host.url.toString() })

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
