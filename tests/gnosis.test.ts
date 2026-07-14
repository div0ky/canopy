import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
const compilerVersion = packageVersion('compiler')
const gnosisVersion = packageVersion('gnosis')
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
    expect(manifest.frameworkVersion).toBe(compilerVersion)
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
        frameworkVersion: compilerVersion,
      }),
    )

    expect(
      sanitizeInspectionValue({
        dependency: { token: 'doxa:transactions' },
        schedule: { token: 'plain-secret', authorization: 'Bearer top-secret' },
        database: 'postgres://doxa:password@localhost/doxa',
        queue: 'redis://doxa:password@localhost/0',
        assertion: 'eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.c2lnbmF0dXJl',
      }),
    ).toEqual({
      dependency: { token: 'doxa:transactions' },
      schedule: { token: '[REDACTED]', authorization: '[REDACTED]' },
      database: 'postgres://doxa:[REDACTED]@localhost/doxa',
      queue: 'redis://doxa:[REDACTED]@localhost/0',
      assertion: '[REDACTED]',
    })
    expect(
      Object.keys(
        sanitizeInspectionValue(
          Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${index}`, index])),
        ) as object,
      ),
    ).toHaveLength(100)
    expect(
      sanitizeInspectionValue(
        'primary postgres://doxa:first@localhost/doxa fallback https://user:second@example.test/',
      ),
    ).toBe(
      'primary postgres://doxa:[REDACTED]@localhost/doxa fallback https://user:[REDACTED]@example.test/',
    )
    expect(
      sanitizeInspectionValue(
        `-----BEGIN PRIVATE KEY-----${'a'.repeat(25_000)}-----END PRIVATE KEY-----`,
      ),
    ).toBe('[REDACTED]')

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
    const modelQueries: unknown[] = []
    const server = createGnosisServer(manifest, {
      queryModels: async (request) => {
        modelQueries.push(request)
        if (request.limit === 100) {
          return {
            modelId: request.modelId,
            fields: request.fields,
            rows: Array.from({ length: 100 }, (_, index) => ({
              id: `counter-${index}-${'a'.repeat(20_000)}`,
              value: 'b'.repeat(20_000),
            })),
            returned: 100,
            truncated: false,
            executionId: 'execution-large',
          }
        }
        return {
          modelId: request.modelId,
          fields: request.fields,
          rows: [{ id: 'counter-1', value: 2, password: 'not-for-agents' }],
          returned: 1,
          truncated: false,
          executionId: 'execution-1',
        }
      },
    })
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
          'query_models',
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

      const queried = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['id', 'value'],
          filters: [{ attribute: 'value', operator: '>=', value: 2 }],
          orderBy: [{ attribute: 'value', direction: 'desc' }],
          limit: 5,
        },
      })
      expect(modelQueries).toEqual([
        {
          modelId: 'model:counters/counter',
          fields: ['id', 'value'],
          filters: [{ attribute: 'value', operator: '>=', value: 2 }],
          orderBy: [{ attribute: 'value', direction: 'desc' }],
          limit: 5,
        },
      ])
      expect(queried.structuredContent).toEqual({
        modelId: 'model:counters/counter',
        fields: ['id', 'value'],
        rows: [{ id: 'counter-1', value: 2, password: '[REDACTED]' }],
        returned: 1,
        truncated: false,
        executionId: 'execution-1',
      })

      const unknownAttribute = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['missing'],
        },
      })
      expect(unknownAttribute.isError).toBe(true)
      expect(modelQueries).toHaveLength(1)

      const oversizedFilter = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['id'],
          filters: [{ attribute: 'id', operator: '=', value: 'a'.repeat(10_001) }],
        },
      })
      expect(oversizedFilter.isError).toBe(true)
      expect(modelQueries).toHaveLength(1)

      const oversizedResult = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['id', 'value'],
          limit: 100,
        },
      })
      expect(oversizedResult.isError).toBe(true)
      const oversizedResultContent = oversizedResult.content as Array<{
        type: string
        text?: string
      }>
      expect(
        JSON.parse(
          oversizedResultContent[0]?.type === 'text' ? (oversizedResultContent[0].text ?? '') : '',
        ),
      ).toEqual({
        code: 'invalid_input',
        message: 'Model query result exceeds 1,000,000 bytes. Request fewer fields or rows.',
      })
      expect(modelQueries).toHaveLength(2)

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

      const sensitiveMissing = await client.callTool({
        name: 'describe_model',
        arguments: { id: 'password=not-for-errors' },
      })
      const sensitiveContent = sensitiveMissing.content as Array<{ type: string; text?: string }>
      expect(
        JSON.parse(sensitiveContent[0]?.type === 'text' ? (sensitiveContent[0].text ?? '') : ''),
      ).toEqual({
        code: 'not_found',
        message: 'Model password=[REDACTED] is not declared.',
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
              version: compilerVersion,
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
          gnosisVersion,
        }),
      )
    } finally {
      await client.close()
    }
  }, 15_000)

  it('rejects relationship declarations that can diverge from runtime behavior', async () => {
    const root = path.join(artifactsDirectory, 'relationship-guard')
    const errors: string[] = []
    expect(
      await runPraxis(['new', 'RelationshipGuard', `--directory=${root}`], workspace, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'))
    await writeFile(
      path.join(root, 'src/app/app.feature.ts'),
      `import { Feature } from '@doxajs/core'\n\nimport { Owner, Related, Other } from './models.js'\n\nexport class AppFeature extends Feature {\n  id = 'app'\n  models = [Owner, Related, Other]\n}\n`,
    )
    const models = path.join(root, 'src/app/models.ts')
    await writeFile(
      models,
      `import { hasMany as doxaHasMany, Model, type ModelRelationship } from '@doxajs/core'\n\ninterface Attributes { id: string; ownerId: string }\nexport class Related extends Model<Attributes> { static override readonly id = 'related' }\nexport class Other extends Model<Attributes> { static override readonly id = 'other' }\nfunction hasMany(related: Parameters<typeof doxaHasMany>[0], options: Parameters<typeof doxaHasMany>[1]): ModelRelationship {\n  return doxaHasMany(related, { foreignKey: \`ignored-\${options.foreignKey}\` })\n}\nexport class Owner extends Model<Attributes> {\n  static override readonly id = 'owner'\n  static override readonly relationships = {\n    related: hasMany(() => Related, { foreignKey: 'ownerId' }),\n  }\n}\n`,
    )
    expect(
      await runPraxis(['build'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors.at(-1)).toContain('must call a Doxa relationship helper directly')

    errors.length = 0
    await writeFile(
      models,
      `import { hasMany, Model } from '@doxajs/core'\n\ninterface Attributes { id: string; ownerId: string }\nexport class Related extends Model<Attributes> { static override readonly id = 'related' }\nexport class Other extends Model<Attributes> { static override readonly id = 'other' }\nexport class Owner extends Model<Attributes> {\n  static override readonly id = 'owner'\n  static override readonly relationships = {\n    related: hasMany(() => {\n      if (Date.now() > 0) return Related\n      return Other\n    }, { foreignKey: 'ownerId' }),\n  }\n}\n`,
    )
    expect(
      await runPraxis(['build'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors.at(-1)).toContain('must reference a model selected by an application Feature')

    errors.length = 0
    await writeFile(
      models,
      `import { hasMany, Model } from '@doxajs/core'\n\ninterface Attributes { id: string; ownerId: string }\nconst runtimeOptions = Date.now() > 0 ? { foreignKey: 'runtimeOwnerId' } : {}\nexport class Related extends Model<Attributes> { static override readonly id = 'related' }\nexport class Other extends Model<Attributes> { static override readonly id = 'other' }\nexport class Owner extends Model<Attributes> {\n  static override readonly id = 'owner'\n  static override readonly relationships = {\n    related: hasMany(() => Related, { foreignKey: 'ownerId', ...runtimeOptions }),\n  }\n}\n`,
    )
    expect(
      await runPraxis(['build'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors.at(-1)).toContain('relationship options must use explicit property assignments')
  })

  it('keeps TypeScript diagnostics off MCP stdout when compilation fails', async () => {
    const invalidSource = path.join(generatedApplication, 'src/app/invalid.ts')
    await writeFile(invalidSource, 'const invalid: string = 42\n')
    try {
      const result = await runChild(
        process.execPath,
        [path.join(workspace, 'packages/praxis/dist/bin.js'), 'mcp'],
        generatedApplication,
      )
      expect(result.code).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('TypeScript build failed with exit code')
      expect(result.stderr).toContain('error TS2322')
    } finally {
      await rm(invalidSource, { force: true })
    }
  })
})

function packageVersion(packageName: 'compiler' | 'gnosis'): string {
  const packageJson = JSON.parse(
    readFileSync(path.join(workspace, 'packages', packageName, 'package.json'), 'utf8'),
  ) as { version: string }
  return packageJson.version
}

function runChild(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr }),
    )
  })
}
