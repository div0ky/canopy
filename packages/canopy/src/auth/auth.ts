import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Actor } from '../context/execution-context.js';

export interface AuthSession {
  readonly id: string;
  readonly actor: Actor;
  readonly expiresAt: Date;
}

export interface SessionStore {
  get(id: string): Promise<AuthSession | null>;
  put(session: AuthSession): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AuthOptions {
  readonly jwtSecret: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly serviceTokenSecret: string;
}

@Injectable()
export class Authentication {
  readonly #jwtKey: Uint8Array;
  readonly #issuer: string;
  readonly #audience: string;

  public constructor(private readonly options: AuthOptions) {
    this.#jwtKey = new TextEncoder().encode(options.jwtSecret);
    this.#issuer = options.issuer ?? 'canopy';
    this.#audience = options.audience ?? 'canopy-api';
  }

  public async issueJwt(actor: Actor, expiresIn = '15m'): Promise<string> {
    return new SignJWT({ type: actor.type, roles: actor.roles, abilities: actor.abilities })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actor.id)
      .setIssuer(this.#issuer)
      .setAudience(this.#audience)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.#jwtKey);
  }

  public async verifyJwt(token: string): Promise<Actor> {
    const { payload } = await jwtVerify(token, this.#jwtKey, {
      issuer: this.#issuer,
      audience: this.#audience,
    });
    return this.actorFromPayload(payload);
  }

  public issueServiceToken(serviceId: string): string {
    const digest = createHash('sha256')
      .update(`${serviceId}:${this.options.serviceTokenSecret}`)
      .digest('hex');
    return `${serviceId}.${digest}`;
  }

  public verifyServiceToken(token: string): Actor {
    const separator = token.indexOf('.');
    if (separator < 1) {
      throw new Error('Invalid service token');
    }
    const serviceId = token.slice(0, separator);
    const expected = Buffer.from(this.issueServiceToken(serviceId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('Invalid service token');
    }
    return { id: serviceId, type: 'service' };
  }

  private actorFromPayload(payload: JWTPayload): Actor {
    if (!payload.sub || (payload['type'] !== 'user' && payload['type'] !== 'service')) {
      throw new Error('JWT does not contain a valid actor');
    }
    const roles = Array.isArray(payload['roles'])
      ? payload['roles'].filter((value): value is string => typeof value === 'string')
      : undefined;
    const abilities = Array.isArray(payload['abilities'])
      ? payload['abilities'].filter((value): value is string => typeof value === 'string')
      : undefined;
    return {
      id: payload.sub,
      type: payload['type'],
      ...(roles ? { roles } : {}),
      ...(abilities ? { abilities } : {}),
    };
  }
}
