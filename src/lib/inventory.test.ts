import { describe, expect, it } from 'vitest'
import { getBalance, getRunningBalances, movementDelta, toCSV } from './inventory'
import type { Item, Movement } from './types'

const item: Item = { id: 'item-1', code: 'editable', name: 'Rice', unit: 'kg', openingBalance: 10, category: '', minimumStock: null, location: '', notes: '', custom: {} }
const movement = (overrides: Partial<Movement>): Movement => ({ id: 'm', itemId: item.id, date: '2025-01-01', kind: 'in', quantity: 1, party: '', document: '', notes: '', custom: {}, ...overrides })

describe('inventory calculations', () => {
  it('applies incoming, outgoing and signed adjustments by item ID, not code', () => {
    const history = [movement({ id: '1', kind: 'in', quantity: 8 }), movement({ id: '2', kind: 'out', quantity: 3 }), movement({ id: '3', kind: 'adjustment', quantity: -2 }), movement({ id: '4', itemId: 'editable', quantity: 100 })]
    expect(history.slice(0, 3).map(movementDelta)).toEqual([8, -3, -2])
    expect(getBalance(item, history)).toBe(13)
    expect(getBalance({ ...item, code: 'renamed' }, history)).toBe(13)
  })

  it('sorts chronologically and preserves input order on equal dates', () => {
    const history = [movement({ id: 'last', date: '2025-01-03', quantity: 5 }), movement({ id: 'first-tie', date: '2025-01-01', kind: 'out', quantity: 2 }), movement({ id: 'second-tie', date: '2025-01-01', kind: 'adjustment', quantity: -1 }), movement({ id: 'other', itemId: 'other', date: '2020-01-01' })]
    expect(getRunningBalances(item, history).map(({ movement, balance }) => [movement.id, balance])).toEqual([['first-tie', 8], ['second-tie', 7], ['last', 12]])
    expect(history.map(entry => entry.id)).toEqual(['last', 'first-tie', 'second-tie', 'other'])
  })

  it('compares timestamp instants rather than their textual offsets', () => {
    const history = [movement({ id: 'later', date: '2025-01-01T02:00:00+02:00' }), movement({ id: 'earlier', date: '2025-01-01T00:30:00+01:00' })]
    expect(getRunningBalances(item, history).map(entry => entry.movement.id)).toEqual(['earlier', 'later'])
  })

  it('rejects invalid quantities, kinds and history dates instead of distorting balances', () => {
    expect(() => movementDelta(movement({ kind: 'out', quantity: -1 }))).toThrow()
    expect(() => movementDelta(movement({ quantity: Number.NaN }))).toThrow()
    expect(() => movementDelta(movement({ kind: 'unknown' as Movement['kind'] }))).toThrow()
    expect(() => getRunningBalances(item, [movement({ date: 'not-a-date' })])).toThrow()
    expect(() => getRunningBalances(item, [movement({ date: '2025-02-30' })])).toThrow()
  })
})

describe('CSV export', () => {
  it('adds a BOM, escapes RFC CSV fields, and neutralizes spreadsheet formulas', () => {
    expect(toCSV(['=header', 'Name', 'Value'], [['=SUM(A1)', '"Rice",\nwhite', -2], ['+cmd', '-2', '@user'], [' \t=1', 'ordinary', 0]])).toBe('\ufeff\'=header,Name,Value\r\n\'=SUM(A1),"""Rice"",\nwhite",-2\r\n\'+cmd,\'-2,\'@user\r\n\' \t=1,ordinary,0')
  })
})
