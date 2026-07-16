import type { SpanLink } from './index.js'

export type AiObservationKind = 'ai.operation' | 'ai.tool' | 'ai.critic' | 'ai.retry'

export interface AiOperationMetadata {
  readonly kind: AiObservationKind
  readonly operationId: string
  readonly provider?: string
  readonly model?: string
  readonly toolId?: string
  readonly criticId?: string
  readonly attempt?: number
  readonly retryCount?: number
  readonly links?: readonly SpanLink[]
}

export interface AiTokenUsage {
  readonly input?: number
  readonly output?: number
  readonly cached?: number
  readonly reasoning?: number
}

export interface AiOperationOutcome {
  readonly tokenUsage?: AiTokenUsage
  readonly finishReason?: string
  readonly cached?: boolean
  readonly verdict?: 'approved' | 'revise' | 'rejected' | 'unknown'
  readonly score?: number
  readonly outcome?: string
  readonly reasonCode?: string
}

export interface AiObservedResult<Output> {
  readonly value: Output
  readonly outcome?: AiOperationOutcome
}

/** Privacy-safe AI instrumentation. Content and customer identifiers are intentionally absent. */
export abstract class AiObservability {
  abstract run<Output>(
    metadata: AiOperationMetadata,
    work: () => Promise<AiObservedResult<Output>>,
  ): Promise<Output>
}
