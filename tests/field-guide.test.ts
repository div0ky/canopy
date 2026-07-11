import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const workspace = path.resolve(import.meta.dirname, '..')
const fieldGuide = path.join(workspace, 'examples/field-guide')

describe('Canopy Field Guide frontend fixture', () => {
  it('is a first-class Next.js, Tailwind, and shadcn/ui workspace application', async () => {
    const packageJson = JSON.parse(await readFile(path.join(fieldGuide, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const components = JSON.parse(await readFile(path.join(fieldGuide, 'components.json'), 'utf8')) as {
      style: string
      rsc: boolean
    }
    expect(packageJson.name).toBe('@canopy/field-guide')
    expect(packageJson.dependencies).toEqual(expect.objectContaining({ next: expect.any(String), react: expect.any(String) }))
    expect(packageJson.devDependencies).toEqual(expect.objectContaining({ tailwindcss: expect.any(String) }))
    expect(components).toEqual(expect.objectContaining({ style: 'base-nova', rsc: true }))
  })

  it('uses the HTTP boundary for public, session, bearer, and protected-action flows', async () => {
    const client = await readFile(path.join(fieldGuide, 'src/lib/canopy-client.ts'), 'utf8')
    const shell = await readFile(path.join(fieldGuide, 'src/components/field-guide.tsx'), 'utf8')
    const proxy = await readFile(path.join(fieldGuide, 'src/app/api/canopy/[[...path]]/route.ts'), 'utf8')
    expect(client).toContain('fetch(`/api/canopy${path}`')
    expect(client).toContain('if (!body?.ok)')
    expect(client).toContain('return body.data')
    expect(shell).toContain('"/health"')
    expect(shell).toContain('"/auth/register"')
    expect(shell).toContain('"/auth/login"')
    expect(shell).toContain('"/auth/tokens"')
    expect(shell).toContain('/secure/counters/')
    expect(proxy).toContain('"authorization"')
    expect(proxy).toContain('"cookie"')
    expect(proxy).toContain('"origin"')
    expect(`${client}\n${shell}\n${proxy}`).not.toContain("from '@canopy/")
    expect(`${client}\n${shell}\n${proxy}`).not.toContain('from "@canopy/')
  })
})
