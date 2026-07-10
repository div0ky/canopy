import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { AuthSession, SessionStore } from '../auth/auth.js';
import type { Cache, CacheLock, CacheSetOptions, RateLimitResult } from '../cache/cache.js';

const RELEASE_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const EXTEND_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RATE_LIMIT = `
local count = redis.call('incr', KEYS[1])
if count == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
local ttl = redis.call('pttl', KEYS[1])
return {count, ttl}
`;

export class RedisCache implements Cache {
  public constructor(
    private readonly redis: Redis,
    private readonly prefix = 'canopy:',
  ) {}

  public async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(this.key(key));
    return value === null ? null : (JSON.parse(value) as T);
  }

  public async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    const redisKey = this.key(key);
    const pipeline = this.redis.multi();
    if (options.ttlMs === undefined) pipeline.set(redisKey, JSON.stringify(value));
    else pipeline.set(redisKey, JSON.stringify(value), 'PX', options.ttlMs);
    for (const tag of options.tags ?? []) {
      pipeline.sadd(this.tagKey(tag), redisKey);
    }
    await pipeline.exec();
  }

  public async remember<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheSetOptions,
  ): Promise<T> {
    const value = await this.get<T>(key);
    if (value !== null) return value;
    const created = await factory();
    await this.set(key, created, options);
    return created;
  }

  public async forget(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }

  public async flushTags(tags: readonly string[]): Promise<void> {
    for (const tag of tags) {
      const tagKey = this.tagKey(tag);
      const keys = await this.redis.smembers(tagKey);
      if (keys.length > 0) await this.redis.del(...keys);
      await this.redis.del(tagKey);
    }
  }

  public async lock(key: string, ttlMs: number, waitMs = 0): Promise<CacheLock> {
    const redisKey = this.key(`lock:${key}`);
    const token = randomUUID();
    const deadline = Date.now() + waitMs;
    do {
      const acquired = await this.redis.set(redisKey, token, 'PX', ttlMs, 'NX');
      if (acquired === 'OK') {
        return {
          key,
          release: async () => {
            await this.redis.eval(RELEASE_LOCK, 1, redisKey, token);
          },
          extend: async (extensionMs) => {
            const extended = await this.redis.eval(EXTEND_LOCK, 1, redisKey, token, extensionMs);
            if (extended !== 1) throw new Error(`Lock ${key} is no longer owned`);
          },
        };
      }
      if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new Error(`Lock ${key} is unavailable`);
  }

  public async increment(key: string, by = 1, ttlMs?: number): Promise<number> {
    const redisKey = this.key(`counter:${key}`);
    const value = await this.redis.incrby(redisKey, by);
    if (ttlMs !== undefined && value === by) await this.redis.pexpire(redisKey, ttlMs);
    return value;
  }

  public decrement(key: string, by = 1, ttlMs?: number): Promise<number> {
    return this.increment(key, -by, ttlMs);
  }

  public async rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const result = (await this.redis.eval(RATE_LIMIT, 1, this.key(`rate:${key}`), windowMs)) as [
      number,
      number,
    ];
    const [count, ttl] = result;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterMs: count <= limit ? 0 : Math.max(0, ttl),
    };
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  private tagKey(tag: string): string {
    return `${this.prefix}tag:${tag}`;
  }
}

export class RedisSessionStore implements SessionStore {
  public constructor(
    private readonly redis: Redis,
    private readonly prefix = 'canopy:session:',
  ) {}

  public async get(id: string): Promise<AuthSession | null> {
    const encoded = await this.redis.get(`${this.prefix}${id}`);
    if (!encoded) return null;
    const session = JSON.parse(encoded) as Omit<AuthSession, 'expiresAt'> & { expiresAt: string };
    return { ...session, expiresAt: new Date(session.expiresAt) };
  }

  public async put(session: AuthSession): Promise<void> {
    const ttlMs = session.expiresAt.getTime() - Date.now();
    if (ttlMs <= 0) throw new Error('Cannot persist an expired session');
    await this.redis.set(`${this.prefix}${session.id}`, JSON.stringify(session), 'PX', ttlMs);
  }

  public async delete(id: string): Promise<void> {
    await this.redis.del(`${this.prefix}${id}`);
  }
}

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}
