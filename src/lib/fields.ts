import type { FieldType } from './types'

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu

export function isIsoDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(value)) return false
  return isIsoDateOnly(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
}

export function isValidFieldValue(type: FieldType, value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || type === 'text') return true
  if (type === 'number') return numeric.test(trimmed) && Number.isFinite(Number(trimmed))
  return isIsoDateOnly(trimmed)
}

export class FieldValueError extends Error {
  constructor(readonly type: FieldType, readonly rows: number[]) {
    super(`Existing values do not match the ${type} type at rows: ${rows.join(', ')}`)
    this.name = 'FieldValueError'
  }
}
