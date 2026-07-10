export class CanopyError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends CanopyError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, 'CANOPY_CONFIGURATION', details);
  }
}

export class HandlerRegistrationError extends CanopyError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, 'HANDLER_REGISTRATION', details);
  }
}

export class ModelNotFoundError extends CanopyError {
  public constructor(model: string, id: string) {
    super(`${model} ${id} was not found`, 'MODEL_NOT_FOUND', { model, id });
  }
}

export class OptimisticLockError extends CanopyError {
  public constructor(model: string, id: string, expectedVersion: number) {
    super(`Concurrent update detected for ${model} ${id}`, 'OPTIMISTIC_LOCK', {
      model,
      id,
      expectedVersion,
    });
  }
}

export class AuthorizationError extends CanopyError {
  public constructor(ability: string) {
    super(`Actor is not authorized to ${ability}`, 'FORBIDDEN', { ability });
  }
}

export class ValidationError extends CanopyError {
  public constructor(details: Readonly<Record<string, unknown>>) {
    super('The request was invalid', 'VALIDATION_FAILED', details);
  }
}
