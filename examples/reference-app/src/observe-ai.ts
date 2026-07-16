import { Action, AiObservability } from '@doxajs/core'

export class ObserveAi extends Action<void, string> {
  static readonly id = 'observe-ai'
  static override readonly access = 'public'

  private readonly ai = this.inject(AiObservability)

  handle(): Promise<string> {
    return this.ai.run(
      {
        kind: 'ai.operation',
        operationId: 'reference.classify',
        provider: 'reference',
        model: 'reference-model',
      },
      async () => ({
        value: 'classified',
        outcome: {
          tokenUsage: { input: 12, output: 3 },
          finishReason: 'stop',
          outcome: 'qualified',
          reasonCode: 'reference-proof',
        },
      }),
    )
  }
}
