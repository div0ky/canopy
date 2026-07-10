import pino, { type Logger as Pino } from 'pino';
import type { ErrorReporter, LogContext, Logger, Tracer } from '../observability/observability.js';

export class PinoLogger implements Logger {
  readonly #logger: Pino;

  public constructor(options: pino.LoggerOptions = {}) {
    this.#logger = pino(options);
  }

  public debug(message: string, context: LogContext = {}): void {
    this.#logger.debug(context, message);
  }
  public info(message: string, context: LogContext = {}): void {
    this.#logger.info(context, message);
  }
  public warn(message: string, context: LogContext = {}): void {
    this.#logger.warn(context, message);
  }
  public error(message: string, context: LogContext = {}): void {
    this.#logger.error(context, message);
  }
}

export class LoggingErrorReporter implements ErrorReporter {
  public constructor(private readonly logger: Logger) {}

  public capture(error: Error, context: LogContext = {}): void {
    this.logger.error(error.message, { ...context, errorName: error.name, stack: error.stack });
  }
}

export class BasicTracer implements Tracer {
  public constructor(private readonly logger: Logger) {}

  public async span<TResult>(
    name: string,
    operation: () => TResult | Promise<TResult>,
    attributes: LogContext = {},
  ): Promise<TResult> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.logger.debug('trace.span', {
        ...attributes,
        name,
        durationMs: performance.now() - startedAt,
      });
    }
  }
}
