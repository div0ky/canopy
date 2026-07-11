import type { NextRequest } from 'next/server'

const CANOPY_API_URL = process.env.CANOPY_API_URL ?? 'http://127.0.0.1:3000'
const forwardedHeaders = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'user-agent',
]
const responseHeadersToRemove = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
])

type RouteContext = { params: Promise<{ path?: string[] }> }

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path = [] } = await context.params
  const target = new URL(`/${path.map(encodeURIComponent).join('/')}`, CANOPY_API_URL)
  target.search = request.nextUrl.search

  const headers = new Headers()
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const response = await fetch(target, {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer(),
    redirect: 'manual',
    cache: 'no-store',
  })
  const responseHeaders = new Headers(response.headers)
  for (const name of responseHeadersToRemove) responseHeaders.delete(name)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const dynamic = 'force-dynamic'
export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
