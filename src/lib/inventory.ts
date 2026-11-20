import type { Item, Movement } from './types'

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
