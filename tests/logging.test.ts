import { ConsoleLogSink, Logger, MemoryLogSink, SecretString } from '@canopy/core'
import { runWithLogContext } from '@canopy/core/runtime'
import { describe, expect, it } from 'vitest'

describe('Canopy logging', () => {
  it('creates structured records with inherited context and recursive redaction', () => {
    const sink = new MemoryLogSink()
    const logger = new Logger({ sink, level: 'debug' }).channel('Billing API')

    runWithLogContext({ executionId: 'exec-1', correlationId: 'corr-1', actorKind: 'user' }, () => {
      logger.info('Payment accepted', {
        invoiceId: 'inv-1',
        authorization: 'Bearer dangerous',
        nested: { apiKey: 'dangerous', safe: 'visible' },
        accessToken: 'dangerous',
        configuredSecret: SecretString.from('dangerous'),
      })
    })

    expect(sink.records).toHaveLength(1)
    expect(sink.records[0]).toMatchObject({
      level: 'info',
      channel: 'billing-api',
      message: 'Payment accepted',
      context: { executionId: 'exec-1', correlationId: 'corr-1', actorKind: 'user' },
      attributes: {
        invoiceId: 'inv-1',
        authorization: '[REDACTED]',
        nested: { apiKey: '[REDACTED]', safe: 'visible' },
        accessToken: '[REDACTED]',
        configuredSecret: '[REDACTED]',
      },
    })
  })

  it('renders readable ANSI channels locally and one JSON record per line in production', () => {
    const pretty: string[] = []
    const json: string[] = []
    const prettyLogger = new Logger({
      sink: new ConsoleLogSink({
        format: 'pretty',
        color: true,
        destination: { isTTY: true, write: (chunk) => pretty.push(chunk) },
      }),
    })
    const jsonLogger = new Logger({
      sink: new ConsoleLogSink({
        format: 'json',
        destination: { write: (chunk) => json.push(chunk) },
      }),
    })

    prettyLogger.channel('http').info('Request completed', { status: 200, durationMs: 12.4 })
    jsonLogger.channel('queue').warn('Job retrying', { attempt: 2 })

    expect(pretty[0]).toContain('\u001B[')
    expect(pretty[0]).toContain('[http]')
    expect(pretty[0]!.replace(/\u001B\[[0-9;]*m/g, '')).toContain('status=200')
    expect(json).toHaveLength(1)
    expect(JSON.parse(json[0]!)).toMatchObject({
      level: 'warn',
      channel: 'queue',
      message: 'Job retrying',
      attributes: { attempt: 2 },
    })
  })

  it('never lets a broken sink alter application behavior', async () => {
    const logger = new Logger({
      sink: new (class extends MemoryLogSink {
        override write(): void {
          throw new Error('sink unavailable')
        }
        override flush(): void {
          throw new Error('flush unavailable')
        }
      })(),
    })

    expect(() => logger.info('Still safe')).not.toThrow()
    expect(() =>
      logger.info(
        'Still safe',
        Object.defineProperty({}, 'danger', {
          enumerable: true,
          get: () => {
            throw new Error('getter failed')
          },
        }),
      ),
    ).not.toThrow()
    await expect(logger.flush()).resolves.toBeUndefined()
  })

  it('redacts credentials embedded in error text', () => {
    const sink = new MemoryLogSink()
    new Logger({ sink }).error(
      'Connection failed for Bearer abc123',
      new Error('postgresql://canopy:password@localhost/db token=abc123'),
    )
    expect(sink.records[0]?.message).toBe('Connection failed for Bearer [REDACTED]')
    expect(sink.records[0]?.error?.message).toBe(
      'postgresql://canopy:[REDACTED]@localhost/db token=[REDACTED]',
    )
  })
})
