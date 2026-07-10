import { randomUUID } from 'node:crypto';
import type { JobDefinition } from '@evergreen/canopy-jobs';
import type { BroadcastMessage, Broadcaster } from '../broadcasting/broadcasting.js';
import type { Cache, CacheLock, CacheSetOptions, RateLimitResult } from '../cache/cache.js';
import type { DispatchOptions, DispatchedJob, JobDispatch, JobInvocation } from '../jobs/jobs.js';
import type {
  Notification,
  Notifiable,
  NotificationSender,
} from '../notifications/notifications.js';
import type { ErrorReporter, LogContext, Logger, Tracer } from '../observability/observability.js';
import type {
  EventJournal,
  Outbox,
  OutboxMessage,
  TransactionManager,
} from '../persistence/ports.js';
import type { PutFileOptions, Storage, StorageDisk, StoredFile } from '../storage/storage.js';
import type { DomainEvent } from '../events/events.js';
import type { AuthSession, SessionStore } from '../auth/auth.js';

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
  tags: Set<string>;
}

export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, AuthSession>();

  public async get(id: string): Promise<AuthSession | null> {
    const session = this.#sessions.get(id);
    if (!session || session.expiresAt <= new Date()) {
      this.#sessions.delete(id);
      return null;
    }
    return structuredClone(session);
  }

  public async put(session: AuthSession): Promise<void> {
    this.#sessions.set(session.id, structuredClone(session));
  }

  public async delete(id: string): Promise<void> {
    this.#sessions.delete(id);
  }
}

export class InMemoryCache implements Cache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #locks = new Map<string, { token: string; expiresAt: number }>();

  public async get<T>(key: string): Promise<T | null> {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return null;
    }
    return structuredClone(entry.value) as T;
  }

  public async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    this.#entries.set(key, {
      value: structuredClone(value),
      ...(options.ttlMs !== undefined ? { expiresAt: Date.now() + options.ttlMs } : {}),
      tags: new Set(options.tags ?? []),
    });
  }

  public async remember<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheSetOptions,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  public async forget(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  public async flushTags(tags: readonly string[]): Promise<void> {
    for (const [key, entry] of this.#entries) {
      if (tags.some((tag) => entry.tags.has(tag))) this.#entries.delete(key);
    }
  }

  public async lock(key: string, ttlMs: number): Promise<CacheLock> {
    const existing = this.#locks.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      throw new Error(`Lock ${key} is unavailable`);
    }
    const token = randomUUID();
    this.#locks.set(key, { token, expiresAt: Date.now() + ttlMs });
    return {
      key,
      release: async () => {
        if (this.#locks.get(key)?.token === token) this.#locks.delete(key);
      },
      extend: async (extensionMs) => {
        if (this.#locks.get(key)?.token !== token)
          throw new Error(`Lock ${key} is no longer owned`);
        this.#locks.set(key, { token, expiresAt: Date.now() + extensionMs });
      },
    };
  }

  public async increment(key: string, by = 1, ttlMs?: number): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const value = current + by;
    await this.set(key, value, ttlMs === undefined ? {} : { ttlMs });
    return value;
  }

  public decrement(key: string, by = 1, ttlMs?: number): Promise<number> {
    return this.increment(key, -by, ttlMs);
  }

  public async rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const count = await this.increment(`rate:${key}`, 1, windowMs);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: count <= limit ? 0 : windowMs,
    };
  }
}

export class FakeStorageDisk implements StorageDisk {
  readonly #files = new Map<string, { contents: Uint8Array; options?: PutFileOptions }>();

  public constructor(private readonly name: string) {}

  public async put(
    path: string,
    contents: Uint8Array,
    options?: PutFileOptions,
  ): Promise<StoredFile> {
    this.#files.set(path, {
      contents: Uint8Array.from(contents),
      ...(options ? { options } : {}),
    });
    return {
      disk: this.name,
      path,
      size: contents.byteLength,
      ...(options?.contentType ? { contentType: options.contentType } : {}),
    };
  }

  public async get(path: string): Promise<Uint8Array> {
    const file = this.#files.get(path);
    if (!file) throw new Error(`File ${path} does not exist`);
    return Uint8Array.from(file.contents);
  }

  public async exists(path: string): Promise<boolean> {
    return this.#files.has(path);
  }

  public async delete(path: string): Promise<void> {
    this.#files.delete(path);
  }

  public async temporaryUrl(path: string, expiresInMs: number): Promise<string> {
    if (!(await this.exists(path))) throw new Error(`File ${path} does not exist`);
    return `https://fake.storage/${this.name}/${encodeURIComponent(path)}?expires=${Date.now() + expiresInMs}`;
  }
}

export class FakeStorage implements Storage {
  readonly #disks = new Map<string, FakeStorageDisk>();

  public disk(name = 'local'): FakeStorageDisk {
    let disk = this.#disks.get(name);
    if (!disk) {
      disk = new FakeStorageDisk(name);
      this.#disks.set(name, disk);
    }
    return disk;
  }
}

export class FakeBroadcaster implements Broadcaster {
  public readonly messages: BroadcastMessage<unknown>[] = [];

  public async broadcast<TPayload>(message: BroadcastMessage<TPayload>): Promise<void> {
    this.messages.push(structuredClone(message) as BroadcastMessage<unknown>);
  }
}

export class FakeNotificationSender implements NotificationSender {
  public readonly sent: Array<{ notifiable: Notifiable; notification: Notification<unknown> }> = [];

  public async send<TData>(
    notifiable: Notifiable,
    notification: Notification<TData>,
  ): Promise<void> {
    this.sent.push({ notifiable: structuredClone(notifiable), notification });
  }
}

export class FakeJobDispatcher implements JobDispatch {
  public readonly dispatched: Array<
    DispatchedJob & { payload: unknown; options?: DispatchOptions }
  > = [];

  public async dispatch<TPayload>(
    job: JobDefinition<TPayload>,
    payload: TPayload,
    options?: DispatchOptions,
  ): Promise<DispatchedJob> {
    const dispatched = {
      id: options?.deduplicationId ?? job.deduplicate?.(payload) ?? randomUUID(),
      queue: job.queue,
      name: job.name,
      payload: structuredClone(payload),
      ...(options ? { options } : {}),
    };
    this.dispatched.push(dispatched);
    return dispatched;
  }

  public async chain(jobs: readonly JobInvocation[]): Promise<readonly DispatchedJob[]> {
    const result: DispatchedJob[] = [];
    for (const invocation of jobs) {
      result.push(await this.dispatch(invocation.job, invocation.payload, invocation.options));
    }
    return result;
  }

  public batch(jobs: readonly JobInvocation[]): Promise<readonly DispatchedJob[]> {
    return Promise.all(
      jobs.map((invocation) =>
        this.dispatch(invocation.job, invocation.payload, invocation.options),
      ),
    );
  }

  public async retryFailed(id: string): Promise<DispatchedJob> {
    const failed = this.dispatched.find((job) => job.id === id);
    if (!failed) throw new Error(`Failed job ${id} was not found`);
    const retried = { id: randomUUID(), queue: failed.queue, name: failed.name };
    this.dispatched.push({ ...retried, payload: failed.payload });
    return retried;
  }
}

export class FakeTransactionManager implements TransactionManager<symbol> {
  public transactions = 0;

  public async run<TResult>(
    operation: (transaction: symbol) => Promise<TResult>,
  ): Promise<TResult> {
    this.transactions += 1;
    return operation(Symbol(`transaction-${this.transactions}`));
  }
}

export class FakeEventJournal implements EventJournal<unknown> {
  public readonly events: DomainEvent[] = [];

  public async append(events: readonly DomainEvent[]): Promise<void> {
    this.events.push(...structuredClone(events));
  }
}

export class FakeOutbox implements Outbox<unknown> {
  public readonly messages: OutboxMessage[] = [];

  public async append(messages: readonly OutboxMessage[]): Promise<void> {
    this.messages.push(...structuredClone(messages));
  }
}

export class FakeLogger implements Logger {
  public readonly entries: Array<{ level: string; message: string; context?: LogContext }> = [];
  public debug(message: string, context?: LogContext): void {
    this.entries.push({ level: 'debug', message, ...(context ? { context } : {}) });
  }
  public info(message: string, context?: LogContext): void {
    this.entries.push({ level: 'info', message, ...(context ? { context } : {}) });
  }
  public warn(message: string, context?: LogContext): void {
    this.entries.push({ level: 'warn', message, ...(context ? { context } : {}) });
  }
  public error(message: string, context?: LogContext): void {
    this.entries.push({ level: 'error', message, ...(context ? { context } : {}) });
  }
}

export class FakeErrorReporter implements ErrorReporter {
  public readonly errors: Array<{ error: Error; context?: LogContext }> = [];
  public capture(error: Error, context?: LogContext): void {
    this.errors.push({ error, ...(context ? { context } : {}) });
  }
}

export class FakeTracer implements Tracer {
  public readonly spans: string[] = [];
  public async span<TResult>(
    name: string,
    operation: () => TResult | Promise<TResult>,
  ): Promise<TResult> {
    this.spans.push(name);
    return operation();
  }
}
