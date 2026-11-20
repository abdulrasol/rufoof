import type { CustomField, FieldType, Item, ItemRequirement } from './types'

export const DEFAULT_REQUIRED_ITEM_FIELDS: readonly ItemRequirement[] = ['name', 'openingBalance']
const ITEM_CORE_FIELDS: readonly ItemRequirement[] = ['code', 'name', 'unit', 'openingBalance', 'category', 'minimumStock', 'location', 'notes']

export function validateItemRequirements(required: readonly ItemRequirement[], fields: readonly CustomField[]): void {
  const allowed = new Set<ItemRequirement>([...ITEM_CORE_FIELDS, ...fields.filter(field => field.target === 'items').map((field): ItemRequirement => `field:${field.id}`)])
  if (!required.includes('name') || new Set(required).size !== required.length || required.some(field => !allowed.has(field))) throw new Error('Invalid required item fields')
}

export function missingItemRequirements(item: Item, required: readonly ItemRequirement[]): ItemRequirement[] {
  return required.filter(field => {
    if (field === 'openingBalance') return !Number.isFinite(item.openingBalance)
    if (field === 'minimumStock') return item.minimumStock === null
    if (field.startsWith('field:')) return !(item.custom[field.slice(6)] ?? '').trim()
    return !String(item[field as Exclude<ItemRequirement, `field:${string}`>]).trim()
  })
}

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
