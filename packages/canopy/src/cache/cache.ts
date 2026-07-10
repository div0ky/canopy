export interface CacheSetOptions {
  readonly ttlMs?: number;
  readonly tags?: readonly string[];
}

export interface CacheLock {
  readonly key: string;
  release(): Promise<void>;
  extend(ttlMs: number): Promise<void>;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;
  remember<T>(key: string, factory: () => Promise<T>, options?: CacheSetOptions): Promise<T>;
  forget(key: string): Promise<void>;
  flushTags(tags: readonly string[]): Promise<void>;
  lock(key: string, ttlMs: number, waitMs?: number): Promise<CacheLock>;
  increment(key: string, by?: number, ttlMs?: number): Promise<number>;
  decrement(key: string, by?: number, ttlMs?: number): Promise<number>;
  rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}
