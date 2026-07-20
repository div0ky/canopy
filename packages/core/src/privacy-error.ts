const privacySensitiveErrors = new WeakMap<object, string>()

/** @internal Marks an error whose original content must not enter diagnostics. */
export function markPrivacySensitiveError(
  error: unknown,
  diagnosticMessage = 'Privacy-sensitive operation failed.',
): void {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    privacySensitiveErrors.set(error, diagnosticMessage)
  }
}

/** @internal Replaces marked error content without changing the thrown application error. */
export function safeDiagnosticError(error: unknown): unknown {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return error
  return privacySensitiveErrors.get(error) ?? error
}
