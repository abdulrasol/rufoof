import type { Item, Movement } from './types'

export type TableColumn<T> = {
  key: string
  value: (row: T) => string | number | null | undefined
  type?: 'text' | 'number' | 'date'
  searchValue?: (row: T) => string
}

function normalizeTableText(value: string): string {
  return value
    .replace(/[٠-٩۰-۹]/gu, digit => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x0660 : 0x06f0)))
    .replace(/[\u061c\u200e\u200f\u066c]/gu, '')
    .replace(/\u066b/gu, '.')
    .replace(/(\d),(?=\d{3}(?:\D|$))/gu, '$1')
}

export function filterAndSortRows<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
  filters: Record<string, string>,
  sort: { key: string; direction: 'asc' | 'desc' } | null,
  language: 'ar' | 'en',
): T[] {
  const columnsByKey = new Map(columns.map(column => [column.key, column]))
  const activeFilters = Object.entries(filters).flatMap(([key, filter]) => {
    const column = columnsByKey.get(key)
    const query = normalizeTableText(filter).trim().toLocaleLowerCase(language)
    return column && query ? [{ column, query }] : []
  })
  const filtered = rows.filter(row => activeFilters.every(({ column, query }) => {
    const raw = normalizeTableText(String(column.value(row) ?? '')).toLocaleLowerCase(language)
    const displayed = normalizeTableText(column.searchValue?.(row) ?? '').toLocaleLowerCase(language)
    return raw.includes(query) || displayed.includes(query)
  }))
  const sortColumn = sort && columnsByKey.get(sort.key)
  if (!sort || !sortColumn) return filtered

  const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' })
  const sorted = filtered.map((row, index) => {
    const raw = sortColumn.value(row)
    const text = String(raw ?? '').trim()
    const empty = raw == null || text === ''
    const normalized = normalizeTableText(text)
    const numeric = sortColumn.type === 'number' ? Number(normalized) : sortColumn.type === 'date' ? dateTime(normalized) : 0
    const invalid = !empty && sortColumn.type !== undefined && sortColumn.type !== 'text' && !Number.isFinite(numeric)
    return { row, index, text, empty, invalid, numeric }
  })
  sorted.sort((a, b) => {
    if (a.empty !== b.empty) return a.empty ? 1 : -1
    if (a.invalid !== b.invalid) return a.invalid ? 1 : -1
    const comparison = a.empty ? 0 : sortColumn.type === 'number' || sortColumn.type === 'date'
      ? a.invalid ? collator.compare(a.text, b.text) : a.numeric < b.numeric ? -1 : a.numeric > b.numeric ? 1 : 0
      : collator.compare(a.text, b.text)
    return (sort.direction === 'asc' ? comparison : -comparison) || a.index - b.index
  })
  return sorted.map(({ row }) => row)
}

export function movementDelta(m: Movement): number {
  if (!Number.isFinite(m.quantity)) throw new Error(`Invalid quantity for movement ${m.id}`)
  if (m.kind === 'adjustment') return m.quantity
  if (m.quantity <= 0) throw new Error(`Invalid quantity for movement ${m.id}`)
  if (m.kind === 'in') return m.quantity
  if (m.kind === 'out') return -m.quantity
  throw new Error(`Invalid kind for movement ${m.id}`)
}

export function getBalance(item: Item, movements: Movement[]): number {
  if (!Number.isFinite(item.openingBalance)) throw new Error(`Invalid opening balance for item ${item.id}`)
  return movements.reduce((balance, movement) => {
    if (movement.itemId !== item.id) return balance
    const next = balance + movementDelta(movement)
    if (!Number.isFinite(next)) throw new Error(`Invalid balance for item ${item.id}`)
    return next
  }, item.openingBalance)
}

function dateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(value)) return NaN
  const date = value.slice(0, 10)
  const day = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return NaN
  return Date.parse(value)
}

export function getRunningBalances(item: Item, movements: Movement[]): Array<{ movement: Movement; balance: number }> {
  if (!Number.isFinite(item.openingBalance)) throw new Error(`Invalid opening balance for item ${item.id}`)
  const history = movements
    .map((movement, index) => ({ movement, index }))
    .filter(({ movement }) => movement.itemId === item.id)
    .map(({ movement, index }) => ({ movement, index, time: typeof movement.date === 'string' ? dateTime(movement.date) : NaN }))
  if (history.some(({ time }) => !Number.isFinite(time))) throw new Error(`Invalid movement date for item ${item.id}`)
  history.sort((a, b) => a.time - b.time || a.index - b.index)
  let balance = item.openingBalance
  return history.map(({ movement }) => {
    balance += movementDelta(movement)
    if (!Number.isFinite(balance)) throw new Error(`Invalid balance for item ${item.id}`)
    return { movement, balance }
  })
}

export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const cell = (value: string | number) => {
    let text = String(value)
    // Spreadsheet programs can ignore leading whitespace or control characters.
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = `'${text}`
    return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
  }
  return `\ufeff${[headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')}`
}
