import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../errors.js';
import { decodeCursor, encodeCursor, validate } from './http.js';

describe('HTTP utilities', () => {
  it('round trips stable compound cursors', () => {
    const cursor = { createdAt: new Date('2026-07-10T12:00:00.000Z'), id: 'order-1' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('converts Zod failures into framework validation errors', () => {
    expect(() => validate(z.object({ count: z.number().positive() }), { count: -1 })).toThrow(
      ValidationError,
    );
  });
});
