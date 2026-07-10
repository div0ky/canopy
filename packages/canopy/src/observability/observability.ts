export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export interface ErrorReporter {
  capture(error: Error, context?: LogContext): void | Promise<void>;
}

export interface Tracer {
  span<TResult>(
    name: string,
    operation: () => TResult | Promise<TResult>,
    attributes?: LogContext,
  ): Promise<TResult>;
}
