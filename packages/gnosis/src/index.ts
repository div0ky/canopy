import { readFileSync } from 'node:fs'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'

import {
  IntrospectionError,
  applicationInfo,
  assertCurrentManifest,
  describeModel,
  inspectGraph,
  inspectSurface,
  safeManifest,
  type InspectionSurface,
} from '@doxajs/introspection'
import type { DoxaManifest } from '@doxajs/manifest'

import {
  documentationIndex,
  searchDocumentation,
  type DocumentationSection,
} from './documentation.js'

export { documentationIndex, searchDocumentation, type DocumentationSection }

export const GNOSIS_PROTOCOL_ADAPTER_VERSION = 1 as const
export const GNOSIS_VERSION = packageVersion()

export interface GnosisServerOptions {
  readonly documentation?: readonly DocumentationSection[]
}

const readOnlyAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
})

const sourceSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  column: z.number().int(),
})
const boundedInspectionSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).max(100),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
})
const applicationInfoSchema = z.object({
  schemaVersion: z.literal(1),
  applicationId: z.string(),
  frameworkVersion: z.string(),
  compilerVersion: z.string(),
  manifestFormatVersion: z.number().int(),
  buildHash: z.string(),
  plugins: z.array(z.string()),
  gnosisVersion: z.string(),
  protocolAdapterVersion: z.literal(1),
})
const graphInspectionSchema = z.object({
  schemaVersion: z.literal(1),
  applicationId: z.string(),
  buildHash: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
})
const modelInspectionSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  exportName: z.string(),
  entityType: z.string(),
  attributes: z.array(z.string()),
  relationships: z.array(z.record(z.string(), z.unknown())),
  storage: z.record(z.string(), z.unknown()),
  source: sourceSchema,
})
const documentationSearchSchema = z.object({
  items: z
    .array(
      z.object({
        package: z.string(),
        version: z.string(),
        source: z.string(),
        heading: z.string(),
        text: z.string(),
        score: z.number().int().nonnegative(),
      }),
    )
    .max(20),
})

const surfaceTools: Readonly<Record<string, InspectionSurface>> = {
  list_actions: 'actions',
  list_queries: 'queries',
  list_events: 'events',
  list_listeners: 'listeners',
  list_observers: 'observers',
  list_jobs: 'jobs',
  list_schedules: 'schedules',
  list_policies: 'policies',
  list_commands: 'commands',
}

export function createGnosisServer(
  manifest: DoxaManifest,
  options: GnosisServerOptions = {},
): McpServer {
  assertCurrentManifest(manifest)
  const docs = options.documentation ?? documentationIndex(manifest.frameworkVersion)
  const server = new McpServer({ name: 'doxa-gnosis', version: GNOSIS_VERSION })

  registerJsonResource(server, 'application-manifest', 'doxa://application/manifest', () =>
    safeManifest(manifest),
  )
  registerJsonResource(server, 'application-graph', 'doxa://application/graph', () =>
    inspectGraph(manifest),
  )
  registerJsonResource(server, 'application-routes', 'doxa://application/routes', () =>
    inspectSurface(manifest, 'routes'),
  )
  registerJsonResource(server, 'application-models', 'doxa://application/models', () =>
    inspectSurface(manifest, 'models'),
  )
  registerJsonResource(server, 'documentation-index', 'doxa://documentation/index', () => docs)

  server.registerTool(
    'application_info',
    {
      description: 'Describe the exact compiled Doxa application and Gnosis versions.',
      outputSchema: applicationInfoSchema,
      annotations: readOnlyAnnotations,
    },
    async () =>
      toolResult(() => ({
        ...applicationInfo(manifest),
        gnosisVersion: GNOSIS_VERSION,
        protocolAdapterVersion: GNOSIS_PROTOCOL_ADAPTER_VERSION,
      })),
  )

  server.registerTool(
    'inspect_graph',
    {
      description: 'Return deterministic counts for the compiled Doxa application graph.',
      outputSchema: graphInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResult(() => inspectGraph(manifest)),
  )

  server.registerTool(
    'list_routes',
    {
      description: 'List compiled HTTP routes with access and source provenance.',
      outputSchema: boundedInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResult(() => inspectSurface(manifest, 'routes')),
  )

  server.registerTool(
    'describe_model',
    {
      description: 'Describe one model, including logical attributes, storage, and relationships.',
      inputSchema: { id: z.string().min(1).max(256) },
      outputSchema: modelInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => toolResult(() => describeModel(manifest, id)),
  )

  for (const [name, surface] of Object.entries(surfaceTools)) {
    server.registerTool(
      name,
      {
        description: `List compiled Doxa ${surface}.`,
        outputSchema: boundedInspectionSchema,
        annotations: readOnlyAnnotations,
      },
      async () => toolResult(() => inspectSurface(manifest, surface)),
    )
  }

  server.registerTool(
    'search_docs',
    {
      description: 'Search version-matched local Doxa documentation.',
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(20).optional(),
      },
      outputSchema: documentationSearchSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ query, limit }) =>
      toolResult(() => ({ items: searchDocumentation(docs, query, limit) })),
  )

  return server
}

export async function startGnosisServer(
  manifest: DoxaManifest,
  options: GnosisServerOptions = {},
): Promise<void> {
  const server = createGnosisServer(manifest, options)
  await server.connect(new StdioServerTransport())
}

function registerJsonResource(
  server: McpServer,
  name: string,
  uri: string,
  read: () => unknown,
): void {
  server.registerResource(
    name,
    uri,
    { mimeType: 'application/json', description: `Read-only ${name.replaceAll('-', ' ')}.` },
    async () => ({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(read(), null, 2) }],
    }),
  )
}

async function toolResult(read: () => unknown) {
  try {
    const structuredContent = read() as Record<string, unknown>
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    }
  } catch (error) {
    const failure = safeFailure(error)
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify(failure) }],
    }
  }
}

function safeFailure(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof IntrospectionError) return { code: error.code, message: error.message }
  return {
    code: 'gnosis_failure',
    message: 'Gnosis could not complete the request.',
  }
}

function packageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('The installed Gnosis package has no valid version.')
  }
  return packageJson.version
}
