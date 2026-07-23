import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'

import {
  IntrospectionError,
  applicationInfo,
  assertCurrentManifest,
  describeAuthentication,
  describeModel,
  inspectGraph,
  inspectSurface,
  safeManifest,
  sanitizeInspectionValue,
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
export const MAX_MODEL_QUERY_RESULT_BYTES = 1_000_000

export interface GnosisModelQueryRequest {
  readonly modelId: string
  readonly fields: readonly string[]
  readonly filters: readonly {
    readonly attribute: string
    readonly operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'ilike'
    readonly value: string | number | boolean | null
  }[]
  readonly orderBy: readonly {
    readonly attribute: string
    readonly direction: 'asc' | 'desc'
  }[]
  readonly limit: number
}

export interface GnosisModelQueryResult {
  readonly modelId: string
  readonly fields: readonly string[]
  readonly rows: readonly Readonly<Record<string, unknown>>[]
  readonly returned: number
  readonly truncated: boolean
  readonly executionId: string
}

export interface GnosisServerOptions {
  readonly queryModels?: (request: GnosisModelQueryRequest) => Promise<GnosisModelQueryResult>
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
  attributeTypes: z.record(z.string(), z.record(z.string(), z.unknown())),
  relationships: z.array(z.record(z.string(), z.unknown())),
  storage: z.record(z.string(), z.unknown()),
  source: sourceSchema,
})
const authenticationInspectionSchema = z.object({
  mode: z.enum(['doxa-owned', 'managed', 'login-only']),
  source: z.enum(['doxa-owned', 'model', 'table']),
  modelId: z.string().optional(),
  table: z.string(),
  identifier: z.record(z.string(), z.unknown()),
  contactEmail: z.string().optional(),
  verification: z.record(z.string(), z.unknown()),
  eligibility: z.array(z.record(z.string(), z.unknown())),
  hashers: z.array(z.string()),
  credentialOwnership: z.enum(['doxa', 'external']),
  credentialUpgrade: z.enum(['never', 'in-place']),
  securityWarnings: z.array(z.string()),
  routes: z.record(z.string(), z.unknown()),
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
const modelQueryValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const modelQueryInputSchema = {
  modelId: z.string().min(1).max(256),
  fields: z.array(z.string().min(1).max(128)).min(1).max(50),
  filters: z
    .array(
      z.object({
        attribute: z.string().min(1).max(128),
        operator: z.enum(['=', '!=', '<', '<=', '>', '>=', 'like', 'ilike']),
        value: modelQueryValueSchema,
      }),
    )
    .max(20)
    .optional(),
  orderBy: z
    .array(
      z.object({
        attribute: z.string().min(1).max(128),
        direction: z.enum(['asc', 'desc']),
      }),
    )
    .max(5)
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
}
const modelQueryOutputSchema = z.object({
  modelId: z.string(),
  fields: z.array(z.string()).max(50),
  rows: z.array(z.record(z.string(), z.unknown())).max(100),
  returned: z.number().int().min(0).max(100),
  truncated: z.boolean(),
  executionId: z.string(),
})

const surfaceTools: Readonly<Record<string, InspectionSurface>> = {
  list_actions: 'actions',
  list_queries: 'queries',
  list_events: 'events',
  list_listeners: 'listeners',
  list_observers: 'observers',
  list_jobs: 'jobs',
  list_schedules: 'schedules',
  list_permission_sources: 'permissionSources',
  list_policies: 'policies',
  list_commands: 'commands',
}

export function createGnosisServer(
  manifest: DoxaManifest,
  options: GnosisServerOptions = {},
): McpServer {
  assertCurrentManifest(manifest)
  const docs = documentationIndex(manifest.frameworkVersion)
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
  registerJsonResource(
    server,
    'application-authentication',
    'doxa://application/authentication',
    () => describeAuthentication(manifest),
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

  server.registerTool(
    'describe_authentication',
    {
      description: 'Describe the compiled authentication mapping without credential values.',
      outputSchema: authenticationInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResult(() => describeAuthentication(manifest)),
  )

  if (options.queryModels) {
    server.registerTool(
      'query_models',
      {
        description:
          'Query one declared Doxa model through a bounded read-only ModelSession. Call describe_model first and request only the logical fields needed for the task.',
        inputSchema: modelQueryInputSchema,
        outputSchema: modelQueryOutputSchema,
        annotations: readOnlyAnnotations,
      },
      async ({ modelId, fields, filters, orderBy, limit }) =>
        toolResult(async () => {
          const model = describeModel(manifest, modelId)
          const uniqueFields = [...new Set(fields)]
          const requestedAttributes = [
            ...uniqueFields,
            ...(filters ?? []).map((filter) => filter.attribute),
            ...(orderBy ?? []).map((order) => order.attribute),
          ]
          const unknown = requestedAttributes.find(
            (attribute) => !model.attributes.includes(attribute),
          )
          if (unknown) {
            throw new IntrospectionError(
              'invalid_input',
              `${modelId} does not declare logical attribute ${unknown}.`,
            )
          }
          const result = sanitizeInspectionValue(
            await options.queryModels!({
              modelId,
              fields: uniqueFields,
              filters: filters ?? [],
              orderBy: orderBy ?? [],
              limit: limit ?? 20,
            }),
          )
          if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_MODEL_QUERY_RESULT_BYTES) {
            throw new IntrospectionError(
              'invalid_input',
              'Model query result exceeds 1,000,000 bytes. Request fewer fields or rows.',
            )
          }
          return result
        }),
    )
  }

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

export function renderGnosisGuidelines(): string {
  return `## Doxa application guidance

- Use Gnosis MCP tools before inferring Doxa application structure from folder names or private implementation details.
- If Gnosis tools are absent after creating or upgrading the application, do not treat registration files as proof that the server initialized. Project MCP configuration is discovered when the client opens the workspace or starts a task; ask the developer to reload or reopen the client, approve project trust if prompted, and start a new agent task. If a new task still lacks the tools, inspect the MCP client startup error.
- Call \`application_info\` when beginning substantial Doxa work and use \`search_docs\` for guidance matching the installed framework version.
- Inspect declared roles with \`inspect_graph\`, \`list_routes\`, the relevant \`list_*\` tool, and \`describe_model\`.
- Use \`query_models\` instead of raw SQL when application data is needed. Call \`describe_model\` first, request only necessary logical fields, and keep the result limit small.
- Treat model records as sensitive. Never expose credentials, tokens, password hashes, or unnecessary personal data.
- Framework-facing roles extend their Doxa role and use \`this.inject()\`. Ordinary services are plain classes with constructor injection.
- Feature declarations and imports determine ownership. Folder names never activate runtime behavior.
- Writes belong in declared actions and Doxa's unit of work. The Gnosis model query tool is read-only.
- Prefer Praxis generators for new framework roles. Do not edit \`.doxa\`, \`dist\`, coverage output, local environment files, or package archives.
- Run \`pnpm test\` before claiming completion.`
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

async function toolResult(read: () => unknown | Promise<unknown>) {
  try {
    const structuredContent = (await read()) as Record<string, unknown>
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
  if (error instanceof IntrospectionError)
    return { code: error.code, message: sanitizeInspectionValue(error.message) as string }
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
