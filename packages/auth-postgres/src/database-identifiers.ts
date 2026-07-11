export function validIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)
}

export function validQualifiedIdentifier(value: string): boolean {
  const parts = value.split('.')
  return parts.length > 0 && parts.length <= 2 && parts.every(validIdentifier)
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function quoteQualified(value: string): string {
  return value.split('.').map(quoteIdentifier).join('.')
}
