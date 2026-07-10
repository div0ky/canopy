import { describe, expect, it } from 'vitest';
import { Authentication } from './auth.js';

describe('Authentication', () => {
  const auth = new Authentication({
    jwtSecret: 'a-secure-test-secret',
    serviceTokenSecret: 'services',
  });

  it('issues and verifies user JWTs', async () => {
    const token = await auth.issueJwt({ id: 'user-1', type: 'user', roles: ['admin'] });
    await expect(auth.verifyJwt(token)).resolves.toMatchObject({
      id: 'user-1',
      type: 'user',
      roles: ['admin'],
    });
  });

  it('issues and verifies constant-time service tokens', () => {
    const token = auth.issueServiceToken('billing');
    expect(auth.verifyServiceToken(token)).toEqual({ id: 'billing', type: 'service' });
    expect(() => auth.verifyServiceToken(`${token}x`)).toThrow(/Invalid service token/);
  });
});
