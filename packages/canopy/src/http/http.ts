import type { ZodType } from 'zod';
import { ValidationError } from '../errors.js';

export interface DataEnvelope<TData> {
  readonly data: TData;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface CursorPage<TData> {
  readonly data: readonly TData[];
  readonly meta: {
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export interface Cursor {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id])).toString(
    'base64url',
  );
}

export function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw new Error('malformed cursor');
    }
    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('invalid cursor date');
    }
    return { createdAt, id: parsed[1] };
  } catch {
    throw new ValidationError({ cursor: ['The cursor is invalid'] });
  }
}

export function validate<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError({
      fields: result.error.flatten().fieldErrors,
      form: result.error.flatten().formErrors,
    });
  }
  return result.data;
}

export abstract class Resource<TInput, TOutput> {
  public abstract serialize(input: TInput): TOutput;

  public collection(input: readonly TInput[]): TOutput[] {
    return input.map((item) => this.serialize(item));
  }

  public item(input: TInput): DataEnvelope<TOutput> {
    return { data: this.serialize(input) };
  }
}
