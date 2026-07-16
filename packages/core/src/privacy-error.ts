const privacySensitiveErrors = new WeakSet<object>()

/** @internal Marks an error whose original content must not enter diagnostics. */
export function markPrivacySensitiveError(error: unknown): void {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    privacySensitiveErrors.add(error)
  }
}

/** @internal Replaces marked error content without changing the thrown application error. */
export function safeDiagnosticError(error: unknown): unknown {
  return ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
    privacySensitiveErrors.has(error)
    ? 'AI operation failed.'
    : error
}
