export class RuntimeIntegrityError extends Error {
  override readonly name = 'RuntimeIntegrityError'
}

export class ConfigurationValidationError extends Error {
  override readonly name = 'ConfigurationValidationError'

  constructor(readonly issues: readonly string[]) {
    super(`Canopy configuration is invalid:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
  }
}

export class RuntimeBootError extends Error {
  override readonly name = 'RuntimeBootError'

  constructor(
    readonly primaryError: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Canopy failed to boot and completed startup unwind.', { cause: primaryError })
  }
}

export class RuntimeShutdownError extends Error {
  override readonly name = 'RuntimeShutdownError'

  constructor(readonly errors: readonly unknown[]) {
    super(`Canopy shutdown completed with ${errors.length} lifecycle failure(s).`)
  }
}

export class ExecutionAdmissionError extends Error {
  override readonly name = 'ExecutionAdmissionError'
}

export class OperationDispatchError extends Error {
  override readonly name = 'OperationDispatchError'
}

export class ExecutionFailureError extends Error {
  override readonly name = 'ExecutionFailureError'

  constructor(
    readonly primaryError: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Canopy execution failed and scoped cleanup also reported failures.', {
      cause: primaryError,
    })
  }
}

export class ExecutionCleanupError extends Error {
  override readonly name = 'ExecutionCleanupError'

  constructor(readonly cleanupErrors: readonly unknown[]) {
    super(`Canopy execution completed with ${cleanupErrors.length} scoped cleanup failure(s).`)
  }
}
