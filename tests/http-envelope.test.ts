import { Http, HttpError, httpFailure, httpSuccess, Logger, type HttpEnvelope } from '@canopy/core'
import { HonoHttpEngine } from '@canopy/http-hono'
import type { CanopyRuntime } from '@canopy/runtime'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('Canopy HTTP response envelopes', () => {
  it('uses one discriminated union for success and failure', () => {
    const success = httpSuccess({ id: 'user-1' })
    const failure = httpFailure('validation_failed', 'The request did not pass validation.', {
      issues: [{ path: ['email'], message: 'Invalid email' }],
    })

    expect(success).toEqual({ ok: true, data: { id: 'user-1' } })
    expect(failure).toEqual({
      ok: false,
      code: 'validation_failed',
      message: 'The request did not pass validation.',
      data: null,
      details: { issues: [{ path: ['email'], message: 'Invalid email' }] },
    })
    expectTypeOf(success).toMatchTypeOf<HttpEnvelope<{ id: string }>>()
    expectTypeOf(failure).toMatchTypeOf<HttpEnvelope<never>>()
  })

  it('keeps status helpers enveloped and no-content bodyless', async () => {
    const created = Http.created({ id: 'user-1' })
    const accepted = Http.accepted(null)
    const noContent = Http.noContent()

    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ ok: true, data: { id: 'user-1' } })
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ ok: true, data: null })
    expect(noContent.status).toBe(204)
    expect(await noContent.text()).toBe('')
  })

  it('automatically wraps plain route payloads and every adapter failure', async () => {
    const runtime = {
      manifest: {
        routes: [
          { id: 'route:test/payload', method: 'GET', path: '/payload' },
          { id: 'route:test/failure', method: 'GET', path: '/failure' },
        ],
      },
      logger: new Logger(),
      authenticateHttp: () => Promise.resolve({
        actor: { kind: 'anonymous' },
        authentication: { state: 'anonymous' },
      }),
      admit: async (_seed: unknown, work: (context: object) => Promise<unknown>) => work({
        correlationId: 'envelope-test',
        trace: { traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 },
      }),
      dispatchRoute: (id: string) => {
        if (id === 'route:test/failure') {
          throw new HttpError(409, 'conflict', 'The resource changed.', { version: 2 })
        }
        return { id: 'payload-1' }
      },
    } as unknown as CanopyRuntime
    const http = new HonoHttpEngine(runtime)

    const success = await http.fetch(new Request('http://canopy.test/payload'))
    expect(success.status).toBe(200)
    expect(await success.json()).toEqual({ ok: true, data: { id: 'payload-1' } })

    const failure = await http.fetch(new Request('http://canopy.test/failure'))
    expect(failure.status).toBe(409)
    expect(await failure.json()).toEqual({
      ok: false,
      code: 'conflict',
      message: 'The resource changed.',
      data: null,
      details: { version: 2 },
    })

    const missing = await http.fetch(new Request('http://canopy.test/missing'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      ok: false,
      code: 'route_not_found',
      message: 'No Canopy route matches GET /missing.',
      data: null,
    })
  })
})
