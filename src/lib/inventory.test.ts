import { describe, expect, it } from 'vitest'
import { filterAndSortRows, getBalance, getRunningBalances, movementDelta, toCSV } from './inventory'
import type { TableColumn } from './inventory'
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

  it('preserves full-ledger running balances when history is filtered and sorted', () => {
    const history = getRunningBalances(item, [movement({ id: 'later', date: '2025-01-03', kind: 'out', quantity: 3 }), movement({ id: 'earlier', date: '2025-01-01', quantity: 5 })])
    const columns: TableColumn<typeof history[number]>[] = [
      { key: 'kind', value: row => row.movement.kind },
      { key: 'balance', value: row => row.balance, type: 'number' },
    ]
    expect(filterAndSortRows(history, columns, { kind: 'out' }, null, 'en').map(row => [row.movement.id, row.balance])).toEqual([['later', 12]])
    expect(filterAndSortRows(history, columns, {}, { key: 'balance', direction: 'asc' }, 'en').map(row => [row.movement.id, row.balance])).toEqual([['later', 12], ['earlier', 15]])
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

describe('table filtering and sorting', () => {
  it('combines column filters with AND and ignores case and blank filters', () => {
    const rows = [
      { name: 'Brown Rice', location: 'North' },
      { name: 'White RICE', location: 'south' },
      { name: 'Beans', location: 'NORTH' },
    ]
    const columns: TableColumn<typeof rows[number]>[] = [
      { key: 'name', value: row => row.name },
      { key: 'location', value: row => row.location },
    ]
    expect(filterAndSortRows(rows, columns, { name: ' RICE ', location: 'nOrTh', ignored: 'missing' }, null, 'en')).toEqual([rows[0]])
    expect(filterAndSortRows(rows, columns, { name: '  ' }, null, 'en')).toEqual(rows)
  })

  it('searches both raw values and translated display values', () => {
    const rows = [{ status: 'in' }, { status: 'out' }]
    const columns: TableColumn<typeof rows[number]>[] = [{
      key: 'status',
      value: row => row.status,
      searchValue: row => row.status === 'in' ? 'وارد' : 'صادر',
    }]
    expect(filterAndSortRows(rows, columns, { status: 'IN' }, null, 'ar')).toEqual([rows[0]])
    expect(filterAndSortRows(rows, columns, { status: 'وارد' }, null, 'ar')).toEqual([rows[0]])
    expect(filterAndSortRows(rows, columns, { status: 'صادر' }, null, 'ar')).toEqual([rows[1]])
  })

  it('normalizes Arabic and Persian digits, group separators, decimals, and direction marks for search', () => {
    const rows = [
      { name: 'قلم أزرق', amount: 1234.5 },
      { name: 'قلم أحمر', amount: -23 },
    ]
    const columns: TableColumn<typeof rows[number]>[] = [
      { key: 'name', value: row => row.name },
      { key: 'amount', value: row => row.amount, searchValue: row => new Intl.NumberFormat('ar').format(row.amount) },
    ]
    expect(filterAndSortRows(rows, columns, { name: 'قلم', amount: '۱٬۲۳۴٫۵' }, null, 'ar')).toEqual([rows[0]])
    expect(filterAndSortRows(rows, columns, { amount: '١,٢٣٤.٥' }, null, 'en')).toEqual([rows[0]])
    expect(filterAndSortRows(rows, columns, { amount: '\u061c-۲۳' }, null, 'ar')).toEqual([rows[1]])
    expect(filterAndSortRows(rows, columns, { amount: '۲۳۴' }, null, 'ar')).toEqual([rows[0]])
  })

  it('sorts numbers numerically with zero distinct from empty values in both directions', () => {
    const rows = [
      { id: 'null', value: null },
      { id: 'ten', value: 10 },
      { id: 'empty', value: '' },
      { id: 'two', value: 2 },
      { id: 'zero', value: 0 },
      { id: 'negative', value: -3 },
      { id: 'undefined', value: undefined },
      { id: 'spaces', value: '   ' },
    ]
    const columns: TableColumn<typeof rows[number]>[] = [{ key: 'value', value: row => row.value, type: 'number' }]
    const ids = (direction: 'asc' | 'desc') => filterAndSortRows(rows, columns, {}, { key: 'value', direction }, 'en').map(row => row.id)
    expect(ids('asc')).toEqual(['negative', 'zero', 'two', 'ten', 'null', 'empty', 'undefined', 'spaces'])
    expect(ids('desc')).toEqual(['ten', 'two', 'zero', 'negative', 'null', 'empty', 'undefined', 'spaces'])
    expect(filterAndSortRows(rows, columns, { value: '0' }, null, 'en').map(row => row.id)).toEqual(['ten', 'zero'])
  })

  it('sorts localized numeric strings and keeps invalid nonempty numbers before empty values', () => {
    const rows = [
      { value: '١٬٢٣٤٫٥' }, { value: '۱۰' }, { value: '٢' },
      { value: '-٣' }, { value: 'invalid' }, { value: '' }, { value: '1,234.5' },
    ]
    const columns: TableColumn<typeof rows[number]>[] = [{ key: 'value', value: row => row.value, type: 'number' }]
    expect(filterAndSortRows(rows, columns, {}, { key: 'value', direction: 'asc' }, 'ar')).toEqual([rows[3], rows[2], rows[1], rows[0], rows[6], rows[4], rows[5]])
    expect(filterAndSortRows(rows, columns, {}, { key: 'value', direction: 'desc' }, 'ar')).toEqual([rows[0], rows[6], rows[1], rows[2], rows[3], rows[4], rows[5]])
    expect(filterAndSortRows(rows, columns, { value: '1234.5' }, null, 'en')).toEqual([rows[0], rows[6]])
    expect(filterAndSortRows(rows, columns, { value: '-3' }, null, 'en')).toEqual([rows[3]])
  })

  it('sorts text with locale-aware numeric comparison and preserves equal rows', () => {
    const rows = [{ text: 'صنف ١٠' }, { text: 'صنف ٢' }, { text: 'صنف ۲' }, { text: '' }]
    const columns: TableColumn<typeof rows[number]>[] = [{ key: 'text', value: row => row.text }]
    expect(filterAndSortRows(rows, columns, {}, { key: 'text', direction: 'asc' }, 'ar')).toEqual([rows[1], rows[2], rows[0], rows[3]])
    expect(filterAndSortRows(rows, columns, {}, { key: 'text', direction: 'desc' }, 'ar')).toEqual([rows[0], rows[1], rows[2], rows[3]])
    const english = [{ text: 'Item 10' }, { text: 'item 2' }, { text: 'ITEM 2' }]
    expect(filterAndSortRows(english, columns, {}, { key: 'text', direction: 'asc' }, 'en')).toEqual([english[1], english[2], english[0]])
  })

  it('sorts by raw values rather than translated display values', () => {
    const rows = [{ value: 'b', label: 'a' }, { value: 'a', label: 'z' }]
    const columns: TableColumn<typeof rows[number]>[] = [{ key: 'value', value: row => row.value, searchValue: row => row.label }]
    expect(filterAndSortRows(rows, columns, {}, { key: 'value', direction: 'asc' }, 'en')).toEqual([rows[1], rows[0]])
  })

  it('searches ISO dates and sorts date instants, preserving ties and putting empty values last', () => {
    const rows = [
      { id: 'late', date: '2025-01-01T01:00:00Z' },
      { id: 'blank', date: '' },
      { id: 'early', date: '2025-01-01T00:30:00+01:00' },
      { id: 'day', date: '2025-01-01' },
      { id: 'same', date: '2025-01-01T03:00:00+02:00' },
      { id: 'invalid', date: '2025-02-30' },
      { id: 'arabic', date: '٢٠٢٤-١٢-٣٠' },
    ]
    const columns: TableColumn<typeof rows[number]>[] = [{ key: 'date', value: row => row.date, type: 'date' }]
    const ids = (direction: 'asc' | 'desc') => filterAndSortRows(rows, columns, {}, { key: 'date', direction }, 'en').map(row => row.id)
    expect(ids('asc')).toEqual(['arabic', 'early', 'day', 'late', 'same', 'invalid', 'blank'])
    expect(ids('desc')).toEqual(['late', 'same', 'day', 'early', 'arabic', 'invalid', 'blank'])
    expect(filterAndSortRows(rows, columns, { date: '٢٠٢٥-٠١-٠١' }, null, 'ar').map(row => row.id)).toEqual(['late', 'early', 'day', 'same'])
  })

  it('ignores filters and sorting for hidden columns and reapplies filters when they return', () => {
    const rows = [{ name: 'Rice', location: 'North' }, { name: 'Beans', location: 'South' }]
    const name: TableColumn<typeof rows[number]> = { key: 'name', value: row => row.name }
    const location: TableColumn<typeof rows[number]> = { key: 'location', value: row => row.location }
    const filters = { location: 'south' }
    expect(filterAndSortRows(rows, [name, location], filters, null, 'en')).toEqual([rows[1]])
    expect(filterAndSortRows(rows, [name], filters, { key: 'location', direction: 'desc' }, 'en')).toEqual(rows)
    expect(filterAndSortRows(rows, [name, location], filters, null, 'en')).toEqual([rows[1]])
  })

  it('always returns a new array without modifying its inputs', () => {
    const rows = Object.freeze([Object.freeze({ value: 2 }), Object.freeze({ value: 1 })])
    const columns: readonly TableColumn<typeof rows[number]>[] = Object.freeze([{ key: 'value', value: row => row.value, type: 'number' }])
    const filters = Object.freeze({ value: '' })
    const sort = Object.freeze({ key: 'value', direction: 'asc' as const })
    const sorted = filterAndSortRows(rows, columns, filters, sort, 'en')
    const unsorted = filterAndSortRows(rows, columns, filters, null, 'en')
    expect(sorted).toEqual([rows[1], rows[0]])
    expect(unsorted).toEqual(rows)
    expect(sorted).not.toBe(rows)
    expect(unsorted).not.toBe(rows)
    expect(rows.map(row => row.value)).toEqual([2, 1])
    expect(filters).toEqual({ value: '' })
    expect(sort).toEqual({ key: 'value', direction: 'asc' })
  })
})
