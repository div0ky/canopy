import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import { createGnosisServer } from '@doxajs/gnosis'
import {
  IntrospectionError,
  applicationInfo,
  assertCurrentManifest,
  inspectSurface,
  sanitizeInspectionValue,
} from '@doxajs/introspection'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { runPraxis } from '@doxajs/praxis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const workspace = path.resolve(import.meta.dirname, '..')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifactsDirectory: string
let generatedApplication: string
let manifest: Awaited<ReturnType<typeof compileApplication>>['manifest']

describe('Gnosis read-only local engineering server', () => {
  beforeAll(async () => {
    artifactsDirectory = await mkdtemp(path.join(tmpdir(), 'doxa-gnosis-'))
    generatedApplication = path.join(artifactsDirectory, 'garden')
    const errors: string[] = []
    const code = await runPraxis(
      ['new', 'Garden', `--directory=${generatedApplication}`],
      workspace,
      { out: () => undefined, error: (message) => errors.push(message) },
    )
    if (code !== 0) throw new Error(errors.join('\n'))
    await symlink(
      path.join(workspace, 'node_modules'),
      path.join(generatedApplication, 'node_modules'),
    )
    ;({ manifest } = await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory,
    }))
  })

  afterAll(async () => {
    await rm(artifactsDirectory, { recursive: true, force: true })
  })

  it('compiles model relationships into the canonical manifest', () => {
    expect(manifest.formatVersion).toBe(3)
    expect(manifest.frameworkVersion).toBe('0.1.0-alpha.11')
    expect(manifest.models.find((model) => model.id.endsWith('/counter'))?.relationships).toEqual([
      {
        name: 'notes',
        kind: 'hasMany',
        relatedModelId: 'model:counters/counter-note',
        localKey: 'id',
        foreignKey: 'counterId',
      },
      {
        name: 'primaryNote',
        kind: 'hasOne',
        relatedModelId: 'model:counters/counter-note',
        localKey: 'id',
        foreignKey: 'counterId',
      },
      {
        name: 'tags',
        kind: 'belongsToMany',
        relatedModelId: 'model:counters/counter-tag',
        throughModelId: 'model:counters/counter-tag-assignment',
        localKey: 'id',
        relatedKey: 'id',
        foreignKey: 'counterId',
        relatedForeignKey: 'tagId',
      },
    ])
  })

  it('shares deterministic bounded facts and fails closed for stale manifests', () => {
    const routes = inspectSurface(manifest, 'routes')
    expect(routes.total).toBeGreaterThan(0)
    expect(routes.items.length).toBeLessThanOrEqual(100)
    expect(applicationInfo(manifest)).toEqual(
      expect.objectContaining({
        applicationId: 'persistence-reference-app',
        manifestFormatVersion: 3,
        frameworkVersion: '0.1.0-alpha.11',
      }),
    )

    expect(
      sanitizeInspectionValue({
        dependency: { token: 'doxa:transactions' },
        schedule: { token: 'plain-secret', authorization: 'Bearer top-secret' },
        database: 'postgres://doxa:password@localhost/doxa',
      }),
    ).toEqual({
      dependency: { token: 'doxa:transactions' },
      schedule: { token: '[REDACTED]', authorization: '[REDACTED]' },
      database: 'postgres://doxa:[REDACTED]@localhost/doxa',
    })

    let staleError: unknown
    try {
      applicationInfo({ ...manifest, applicationId: 'tampered' })
    } catch (error) {
      staleError = error
    }
    expect(staleError).toBeInstanceOf(IntrospectionError)
    expect((staleError as IntrospectionError).code).toBe('stale_manifest')
  })

  it('returns the same structured route facts through Praxis JSON', async () => {
    const output: string[] = []
    const errors: string[] = []
    expect(
      await runPraxis(['route:list', '--json'], generatedApplication, {
        out: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    expect(errors).toEqual([])
    const generatedManifest: unknown = JSON.parse(
      await readFile(path.join(generatedApplication, '.doxa/manifest.json'), 'utf8'),
    )
    assertCurrentManifest(generatedManifest)
    expect(JSON.parse(output.at(-1)!)).toEqual(inspectSurface(generatedManifest, 'routes'))
  })

  it('serves the real MCP protocol with parity, structured errors, and exact-version docs', async () => {
    const server = createGnosisServer(manifest)
    const client = new Client({ name: 'gnosis-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'application_info',
          'inspect_graph',
          'list_routes',
          'describe_model',
          'search_docs',
        ]),
      )
      expect(tools.tools.find((tool) => tool.name === 'application_info')?.outputSchema).toEqual(
        expect.objectContaining({ type: 'object' }),
      )

      const routes = await client.callTool({ name: 'list_routes', arguments: {} })
      expect(routes.structuredContent).toEqual(inspectSurface(manifest, 'routes'))

      const model = await client.callTool({
        name: 'describe_model',
        arguments: { id: 'model:counters/counter' },
      })
      expect(model.structuredContent).toEqual(
        expect.objectContaining({
          id: 'model:counters/counter',
          relationships: expect.arrayContaining([
            expect.objectContaining({ name: 'tags', kind: 'belongsToMany' }),
          ]),
        }),
      )

      const missing = await client.callTool({
        name: 'describe_model',
        arguments: { id: 'model:missing' },
      })
      expect(missing.isError).toBe(true)
      expect(missing.structuredContent).toBeUndefined()
      const missingContent = missing.content as Array<{ type: string; text?: string }>
      expect(
        JSON.parse(missingContent[0]?.type === 'text' ? (missingContent[0].text ?? '') : ''),
      ).toEqual({
        code: 'not_found',
        message: 'Model model:missing is not declared.',
      })

      const invalid = await client.callTool({
        name: 'describe_model',
        arguments: { id: '' },
      })
      expect(invalid.isError).toBe(true)
      expect(invalid.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Input validation'),
        }),
      ])

      const docs = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'model relationships', limit: 2 },
      })
      expect(docs.structuredContent).toEqual(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              package: '@doxajs/core',
              version: '0.1.0-alpha.11',
              source: 'models.md',
            }),
          ]),
        }),
      )

      const resources = await client.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toEqual(
        expect.arrayContaining([
          'doxa://application/manifest',
          'doxa://application/graph',
          'doxa://documentation/index',
        ]),
      )
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('is spawned by generated project registration without a manual start', async () => {
    const registration = JSON.parse(
      await readFile(path.join(generatedApplication, '.mcp.json'), 'utf8'),
    ) as {
      mcpServers: {
        gnosis: { command: string; args: string[] }
      }
    }
    expect(registration.mcpServers.gnosis).toEqual({
      command: 'node',
      args: ['./node_modules/@doxajs/praxis/dist/bin.js', 'mcp'],
      env: {},
    })
    const client = new Client({ name: 'gnosis-stdio-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: registration.mcpServers.gnosis.command,
      args: registration.mcpServers.gnosis.args,
      cwd: generatedApplication,
      env: { ...getDefaultEnvironment(), CI: '1' },
      stderr: 'pipe',
    })
    let stderr = ''
    transport.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    try {
      await client.connect(transport)
    } catch (error) {
      throw new Error(`doxa mcp failed: ${String(error)}\n${stderr}`, { cause: error })
    }
    try {
      const result = await client.callTool({ name: 'application_info', arguments: {} })
      expect(result.structuredContent).toEqual(
        expect.objectContaining({
          applicationId: 'garden',
          manifestFormatVersion: 3,
          gnosisVersion: '0.1.0-alpha.11',
        }),
      )
    } finally {
      await client.close()
    }
  }, 15_000)
})
