import { Inject, Injectable } from '@nestjs/common';
import type { BroadcastMessage, Broadcaster } from './broadcasting/broadcasting.js';
import type { Cache, CacheLock, CacheSetOptions, RateLimitResult } from './cache/cache.js';
import type {
  Notification,
  Notifiable,
  NotificationSender,
} from './notifications/notifications.js';
import type { ErrorReporter, LogContext, Logger, Tracer } from './observability/observability.js';
import type { Storage, StorageDisk } from './storage/storage.js';
import {
  CANOPY_BROADCASTER,
  CANOPY_CACHE,
  CANOPY_LOGGER,
  CANOPY_NOTIFICATIONS,
  CANOPY_REPORTER,
  CANOPY_STORAGE,
  CANOPY_TRACER,
} from './tokens.js';

@Injectable()
export class CacheManager implements Cache {
  public constructor(@Inject(CANOPY_CACHE) private readonly driver: Cache) {}
  public get<T>(key: string): Promise<T | null> {
    return this.driver.get<T>(key);
  }
  public set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    return this.driver.set(key, value, options);
  }
  public remember<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheSetOptions,
  ): Promise<T> {
    return this.driver.remember(key, factory, options);
  }
  public forget(key: string): Promise<void> {
    return this.driver.forget(key);
  }
  public flushTags(tags: readonly string[]): Promise<void> {
    return this.driver.flushTags(tags);
  }
  public lock(key: string, ttlMs: number, waitMs?: number): Promise<CacheLock> {
    return this.driver.lock(key, ttlMs, waitMs);
  }
  public increment(key: string, by?: number, ttlMs?: number): Promise<number> {
    return this.driver.increment(key, by, ttlMs);
  }
  public decrement(key: string, by?: number, ttlMs?: number): Promise<number> {
    return this.driver.decrement(key, by, ttlMs);
  }
  public rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    return this.driver.rateLimit(key, limit, windowMs);
  }
}

@Injectable()
export class StorageManager implements Storage {
  public constructor(@Inject(CANOPY_STORAGE) private readonly driver: Storage) {}
  public disk(name?: string): StorageDisk {
    return this.driver.disk(name);
  }
}

@Injectable()
export class Notifications implements NotificationSender {
  public constructor(@Inject(CANOPY_NOTIFICATIONS) private readonly driver: NotificationSender) {}
  public send<TData>(notifiable: Notifiable, notification: Notification<TData>): Promise<void> {
    return this.driver.send(notifiable, notification);
  }
}

@Injectable()
export class Broadcasting implements Broadcaster {
  public constructor(@Inject(CANOPY_BROADCASTER) private readonly driver: Broadcaster) {}
  public broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void> {
    return this.driver.broadcast(message);
  }
}

@Injectable()
export class Log implements Logger {
  public constructor(@Inject(CANOPY_LOGGER) private readonly driver: Logger) {}
  public debug(message: string, context?: LogContext): void {
    this.driver.debug(message, context);
  }
  public info(message: string, context?: LogContext): void {
    this.driver.info(message, context);
  }
  public warn(message: string, context?: LogContext): void {
    this.driver.warn(message, context);
  }
  public error(message: string, context?: LogContext): void {
    this.driver.error(message, context);
  }
}

@Injectable()
export class Report implements ErrorReporter {
  public constructor(@Inject(CANOPY_REPORTER) private readonly driver: ErrorReporter) {}
  public capture(error: Error, context?: LogContext): void | Promise<void> {
    return this.driver.capture(error, context);
  }
}

@Injectable()
export class Tracing implements Tracer {
  public constructor(@Inject(CANOPY_TRACER) private readonly driver: Tracer) {}

  public span<TResult>(
    name: string,
    operation: () => TResult | Promise<TResult>,
    attributes?: LogContext,
  ): Promise<TResult> {
    return this.driver.span(name, operation, attributes);
  }
}
