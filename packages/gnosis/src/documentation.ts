export interface DocumentationSection {
  readonly package: string
  readonly version: string
  readonly source: string
  readonly heading: string
  readonly text: string
}

export interface DocumentationSearchResult extends DocumentationSection {
  readonly score: number
}

export const MAX_DOCUMENTATION_RESULTS = 20

export function documentationIndex(version: string): readonly DocumentationSection[] {
  return Object.freeze([
    section(
      '@doxajs/core',
      version,
      'principles.md',
      'Application-facing design',
      'Doxa owns application semantics. Framework roles extend their Doxa role and use this.inject(). Ordinary services are plain classes with constructor injection. Folder names never carry runtime meaning.',
    ),
    section(
      '@doxajs/core',
      version,
      'models.md',
      'Models and relationships',
      'Models declare stable IDs, logical attribute types, storage ownership, and relationships. Query builders use logical attributes, remain read-only, and never expose SQL or adapter types to feature code.',
    ),
    section(
      '@doxajs/core',
      version,
      'operations.md',
      'Actions and queries',
      'Actions represent intentional state changes and participate in the unit of work. Queries express reads and cannot hide durable mutations. Entry roles explicitly declare public access or an ability owned by a policy or application permission source.',
    ),
    section(
      '@doxajs/core',
      version,
      'authorization.md',
      'Application permission sources',
      'One optional PermissionSource maps application-owned group and user permission facts to a literal stable Doxa ability catalog at most once per execution. Credential constraints deny first, and an optional resource Policy may narrow but never widen a source grant. Permission results are not ExecutionContext and never propagate through queues or trace baggage.',
    ),
    section(
      '@doxajs/praxis',
      version,
      'praxis.md',
      'Canonical command suite',
      "Praxis is Doxa's only command suite. Use doxa build, doxa dev, doxa migrate, doxa make:*, and inspection commands such as doxa permission-source:list. Generated artifacts remain under .doxa and production roles consume prebuilt artifacts.",
    ),
    section(
      '@doxajs/praxis',
      version,
      'deployment.md',
      'Artifact-only deployment',
      'Build one immutable image with doxa build. Run migrations as an explicit release job. Web and background roles consume the same image and generated manifest; runtime startup never compiles source or applies migrations.',
    ),
    section(
      '@doxajs/gnosis',
      version,
      'gnosis.md',
      'Read-only local server',
      'Gnosis runs locally over MCP stdio. It exposes the validated compiled application graph and version-matched guidance. Its query_models tool performs bounded non-production reads by stable model ID and logical attribute through a fresh read-only Doxa execution. It does not accept SQL, run arbitrary commands, or mutate application data or the workspace.',
    ),
  ])
}

export function searchDocumentation(
  sections: readonly DocumentationSection[],
  query: string,
  limit = 10,
): readonly DocumentationSearchResult[] {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error('Documentation query must contain 1 through 200 characters.')
  }
  const tokens = [...new Set(normalized.split(/\s+/).filter(Boolean))]
  return Object.freeze(
    sections
      .map((entry) => {
        const heading = entry.heading.toLowerCase()
        const haystack = `${entry.package} ${entry.source} ${heading} ${entry.text.toLowerCase()}`
        const score = tokens.reduce(
          (total, token) =>
            total + (heading.includes(token) ? 3 : haystack.includes(token) ? 1 : 0),
          0,
        )
        return { ...entry, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.heading.localeCompare(right.heading))
      .slice(0, Math.min(Math.max(limit, 1), MAX_DOCUMENTATION_RESULTS)),
  )
}

function section(
  packageName: string,
  version: string,
  source: string,
  heading: string,
  text: string,
): DocumentationSection {
  return Object.freeze({ package: packageName, version, source, heading, text })
}
