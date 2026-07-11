import { PraxisCommandError } from './errors.js'

export function option(arguments_: readonly string[], name: string): string | undefined {
  return arguments_.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
}

export function integerOption(args: readonly string[], name: string, fallback: number): number {
  const value = option(args, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535)
    throw new PraxisCommandError(`--${name} must be an integer from 0 through 65535.`)
  return parsed
}

export function numberOption(args: readonly string[], name: string, fallback: number): number {
  const value = option(args, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new PraxisCommandError(`--${name} must be a positive number.`)
  return parsed
}

export function positiveIntegerOption(
  args: readonly string[],
  name: string,
  fallback: number,
): number {
  const value = option(args, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new PraxisCommandError(`--${name} must be a positive integer.`)
  return parsed
}

export function required(value: string | undefined, message: string): string {
  if (!value) throw new PraxisCommandError(message)
  return value
}

export function pascal(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
}
