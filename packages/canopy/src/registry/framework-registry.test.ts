import { describe, expect, it } from 'vitest';
import { HandlerRegistrationError } from '../errors.js';
import { FrameworkRegistry } from './framework-registry.js';

describe('FrameworkRegistry', () => {
  it('rejects duplicate handlers at declaration time', () => {
    class UniqueRegistryAction {}
    class FirstHandler {}
    class DuplicateHandler {}
    FrameworkRegistry.registerHandler({
      kind: 'action',
      message: UniqueRegistryAction,
      handler: FirstHandler,
    });
    expect(() =>
      FrameworkRegistry.registerHandler({
        kind: 'action',
        message: UniqueRegistryAction,
        handler: DuplicateHandler,
      }),
    ).toThrow(HandlerRegistrationError);
  });

  it('reports missing handlers during bootstrap validation', () => {
    class MissingRegistryQuery {}
    expect(() => FrameworkRegistry.assertHandled('query', [MissingRegistryQuery])).toThrow(
      /Missing query handlers: MissingRegistryQuery/,
    );
  });
});
