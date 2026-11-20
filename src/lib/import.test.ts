import { describe, expect, it } from 'vitest'
import { buildPreview, editImportTable, mappingProblems, suggestTargets } from './import'
import { toTable } from './spreadsheet'
import type { CustomField } from './types'

const table = (headers: string[], rows: string[][]) => ({ sheet: 'Sheet1', headerRow: 0, headers, rows, rowNumbers: rows.map((_, index) => index + 2) })

const cost: CustomField = { id: 'field-cost', name: 'Cost', type: 'number', target: 'items' }
const expires: CustomField = { id: 'field-expiry', name: 'Expiry', type: 'date', target: 'items' }

describe('column mapping', () => {
  it('suggests Arabic and English headers', () => {
    expect(suggestTargets(['الرمز', 'الاسم', 'الوحدة', 'الرصيد الافتتاحي', 'الحد الأدنى']))
      .toEqual(['code', 'name', 'unit', 'openingBalance', 'minimumStock'])
    expect(suggestTargets(['SKU', 'Item', 'UOM', 'Qty', 'Location']))
      .toEqual(['code', 'name', 'unit', 'openingBalance', 'location'])
  })

  it('requires explicit mapping for duplicate or ambiguous headers', () => {
    expect(suggestTargets(['Code', 'Name', 'Cost', 'Cost'], [cost])).toEqual(['code', 'name', '', ''])
    expect(suggestTargets(['Balance', 'Cost'], [{ id: 'balance', name: 'Balance', type: 'text', target: 'items' }, cost])).toEqual(['', 'field:field-cost'])
  })

  it('defaults to requiring only name and opening balance, while reporting duplicate targets', () => {
    expect(mappingProblems(['code', 'code', '', 'openingBalance'])).toEqual({
      missing: ['name'], duplicate: ['code'],
    })
    expect(mappingProblems(['name', 'openingBalance'])).toEqual({ missing: [], duplicate: [] })
  })

  it('reports all selected missing core and custom targets alongside unique duplicates', () => {
    const required = ['name', 'unit', 'category', 'field:field-cost', 'field:unknown'] as const
    expect(mappingProblems(['name', 'name', 'name', '', '', 'field:field-cost', 'field:field-cost'], required)).toEqual({
      missing: ['unit', 'category', 'field:unknown'], duplicate: ['name', 'field:field-cost'],
    })
    expect(mappingProblems([], [])).toEqual({ missing: [], duplicate: [] })
  })
})

describe('import corrections', () => {
  it('keeps source rows unchanged and preserves row numbers and untouched values', () => {
    const source = toTable({ name: 'Stock', rows: [['Name', 'Balance', 'Notes'], ['', 'bad', 'Keep'], [], ['Ink', '7', 'Other'], ['Tea', '4', 'Last']] })
    const changes = { 2: { 0: 'Paper', 1: '12', 2: '' }, 4: { 0: 'Changed' } }
    const corrected = editImportTable(source, changes, new Set([4]))
    expect(corrected.rowNumbers).toEqual([2, 5])
    expect(corrected.rows).toEqual([['Paper', '12', ''], ['Tea', '4', 'Last']])
    expect(source.rowNumbers).toEqual([2, 4, 5])
    expect(source.rows).toEqual([['', 'bad', 'Keep'], ['Ink', '7', 'Other'], ['Tea', '4', 'Last']])
    const restored = editImportTable(source, changes, new Set())
    expect(restored.rows[1]).toEqual(['Changed', '7', 'Other'])
  })

  it('revalidates corrected and restored rows without losing mapped values', () => {
    const source = table(['Code', 'Name', 'Balance', 'Notes'], [['X', '', 'bad', 'Keep'], ['X', 'Ink', '2', 'Other']])
    const mapping = ['code', 'name', 'openingBalance', 'notes'] as const
    const changes = { 2: { 1: 'Paper', 2: '12' } }
    const corrected = buildPreview(editImportTable(source, changes, new Set()), [...mapping], [], [])
    expect(corrected.items[0]).toMatchObject({ code: 'X', name: 'Paper', openingBalance: 12, notes: 'Keep' })
    expect(corrected.issues).toEqual([{ row: 3, code: 'duplicateCode' }])
    const skipped = buildPreview(editImportTable(source, changes, new Set([2])), [...mapping], [], [])
    expect(skipped.items[0]).toMatchObject({ code: 'X', name: 'Ink', notes: 'Other' })
    expect(skipped.issues).toEqual([])
    const restored = buildPreview(editImportTable(source, changes, new Set()), [...mapping], [], [])
    expect(restored.issues).toEqual([{ row: 3, code: 'duplicateCode' }])
  })
})

describe('import preview', () => {
  const targets = ['code', 'name', 'unit', 'openingBalance', 'minimumStock', 'category', 'Cost', 'Expiry'] as const
  const mapping = ['code', 'name', 'unit', 'openingBalance', 'minimumStock', 'category', 'field:field-cost', 'field:field-expiry'] as const

  it('requires only name and opening balance by default', () => {
    const preview = buildPreview(
      table(['Name', 'Opening'], [['Paper', '12'], ['', '0'], ['Ink', '  '], ['Oil', '0']]),
      ['name', 'openingBalance'], [], [],
    )
    expect(preview.items).toHaveLength(2)
    expect(preview.items.map(item => [item.code, item.name, item.unit, item.openingBalance])).toEqual([
      ['', 'Paper', '', 12], ['', 'Oil', '', 0],
    ])
    expect(preview.issues).toEqual([
      { row: 3, code: 'name' }, { row: 4, code: 'required', field: 'openingBalance' },
    ])
    expect(preview.skipped).toBe(0)
  })

  it('uses zero for blank or unmapped optional opening balances', () => {
    const required = ['name'] as const
    const preview = buildPreview(
      table(['Name', 'Opening'], [['Paper', ''], ['Ink', '  '], ['Glue', '0']]),
      ['name', 'openingBalance'], [], [], required,
    )
    const unmapped = buildPreview(table(['Name'], [['Tape']]), ['name'], [], [], required)
    expect(preview.issues).toEqual([])
    expect(preview.items.map(item => item.openingBalance)).toEqual([0, 0, 0])
    expect(unmapped.issues).toEqual([])
    expect(unmapped.items[0].openingBalance).toBe(0)
    const noRequirements = buildPreview(table(['Name'], [['']]), ['name'], [], [], [])
    expect(noRequirements.items[0]).toMatchObject({ name: '', openingBalance: 0 })
  })

  it('builds valid items and keeps mapped custom values', () => {
    const preview = buildPreview(table([...targets], [['A-1', 'Paper', 'box', '12', '3', 'Office', '2.5', '2027-01-31']]), [...mapping], [cost, expires], [])
    expect(preview.issues).toEqual([])
    expect(preview.skipped).toBe(0)
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({
      code: 'A-1', name: 'Paper', unit: 'box', openingBalance: 12, minimumStock: 3,
      category: 'Office', location: '', notes: '', custom: { 'field-cost': '2.5', 'field-expiry': '2027-01-31' },
    })
    expect(preview.items[0].id).toMatch(/[0-9a-f-]{36}/u)
  })

  it('skips codes that already exist and reports duplicates inside the file', () => {
    const preview = buildPreview(
      table([...targets], [
        ['a-1', 'Paper', 'box', '1', '', '', '', ''],
        ['C-1', 'Clips', 'box', '5', '', '', '', ''],
        [' c-1 ', 'Duplicate', 'box', '5', '', '', '', ''],
        ['A-2', 'Pens', 'box', '5', '', '', '', ''],
        ['A-3', 'Ink', 'box', '5', '', '', '', ''],
      ]),
      [...mapping], [cost, expires], ['A-1', ' A-3 '],
    )
    expect(preview.skipped).toBe(2)
    expect(preview.existingRows).toEqual([2, 6])
    expect(preview.items.map(item => item.code)).toEqual(['C-1', 'A-2'])
    expect(preview.issues).toEqual([{ row: 4, code: 'duplicateCode' }])
  })

  it('does not skip or flag empty codes, even when existing codes are blank', () => {
    const preview = buildPreview(
      table(['Code', 'Name', 'Opening'], [
        ['', 'Paper', '1'], ['  ', 'Ink', '2'], ['X-1', 'Pens', '3'],
        [' x-1 ', 'Duplicate', '4'], ['existing', 'Existing', '5'],
      ]),
      ['code', 'name', 'openingBalance'], [], ['', '  ', ' Existing '],
    )
    expect(preview.items.map(item => item.code)).toEqual(['', '', 'X-1'])
    expect(preview.skipped).toBe(1)
    expect(preview.issues).toEqual([{ row: 5, code: 'duplicateCode' }])
  })

  it('reports missing required values and invalid numbers or dates', () => {
    const preview = buildPreview(
      table([...targets], [
        ['', 'Paper', 'box', '1', '', '', '', ''],
        ['B-1', '', 'box', '1', '', '', '', ''],
        ['B-2', 'Pens', '', '1', '', '', '', ''],
        ['B-3', 'Ink', 'box', '1.2.3', '', '', '', ''],
        ['B-4', 'Tape', 'roll', '1', '-2', '', '', ''],
        ['B-5', 'Glue', 'tube', '1', '', '', 'abc', ''],
        ['B-6', 'Glue', 'tube', '1', '', '', '', '2027-13-01'],
        ['B-7', 'Staples', 'box', '', '', '', '', ''],
      ]),
      [...mapping], [cost, expires], [], ['code', 'name', 'unit', 'openingBalance'],
    )
    expect(preview.items).toHaveLength(0)
    expect(preview.issues).toEqual([
      { row: 2, code: 'code' }, { row: 3, code: 'name' }, { row: 4, code: 'unit' },
      { row: 5, code: 'openingBalance' }, { row: 6, code: 'minimumStock' },
      { row: 7, code: 'customNumber', field: 'field:field-cost' }, { row: 8, code: 'customDate', field: 'field:field-expiry' },
      { row: 9, code: 'required', field: 'openingBalance' },
    ])
  })

  it('validates selected unit, category, and custom requirements', () => {
    const required = ['name', 'unit', 'category', 'field:field-cost', 'field:field-expiry'] as const
    const preview = buildPreview(
      table(['Name', 'Unit', 'Category', 'Cost', 'Expiry'], [
        ['Paper', ' ', 'Office', '1', '2028-02-29'],
        ['Paper', 'box', '', '1', '2028-02-29'],
        ['Paper', 'box', 'Office', ' ', '2028-02-29'],
        ['Paper', 'box', 'Office', '0', ''],
        ['Paper', 'box', 'Office', '0', '2028-02-29'],
      ]),
      ['name', 'unit', 'category', 'field:field-cost', 'field:field-expiry'], [cost, expires], [], required,
    )
    expect(preview.issues).toEqual([
      { row: 2, code: 'unit' },
      { row: 3, code: 'required', field: 'category' },
      { row: 4, code: 'required', field: 'field:field-cost' },
      { row: 5, code: 'required', field: 'field:field-expiry' },
    ])
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0].custom).toEqual({ 'field-cost': '0', 'field-expiry': '2028-02-29' })
  })

  it.each(['unit', 'category', 'field:field-cost', 'field:unknown'] as const)(
    'reports unmapped required %s on each row', target => {
      const preview = buildPreview(table(['Name'], [['Paper'], ['Pens']]), ['name'], [cost], [], ['name', target])
      const issue = target === 'unit' ? { code: 'unit' } : { code: 'required', field: target }
      expect(preview.issues).toEqual([{ row: 2, ...issue }, { row: 3, ...issue }])
      expect(preview.items).toEqual([])
    },
  )

  it.each([
    ['minimumStock', '0'], ['location', 'Shelf'], ['notes', 'Note'],
  ] as const)('checks empty and nonempty required %s', (target, validValue) => {
    const preview = buildPreview(
      table(['Name', 'Value'], [['Paper', '  '], ['Pens', validValue]]),
      ['name', target], [], [], ['name', target],
    )
    expect(preview.issues).toEqual([{ row: 2, code: 'required', field: target }])
    expect(preview.items).toHaveLength(1)
  })

  it('validates supplied optional numeric and date values strictly', () => {
    const preview = buildPreview(
      table(['Name', 'Opening', 'Minimum', 'Cost', 'Expiry'], [
        ['Paper', '1.2.3', '', '', ''],
        ['Paper', '1e999', '', '', ''],
        ['Paper', '', '-2', '', ''],
        ['Paper', '', '0x2', '', ''],
        ['Paper', '', '', 'Infinity', ''],
        ['Paper', '', '', '', '2027-02-29'],
        ['Paper', '-2.5e1', '0', '1.25e2', '2028-02-29'],
      ]),
      ['name', 'openingBalance', 'minimumStock', 'field:field-cost', 'field:field-expiry'],
      [cost, expires], [], ['name'],
    )
    expect(preview.issues).toEqual([
      { row: 2, code: 'openingBalance' }, { row: 3, code: 'openingBalance' },
      { row: 4, code: 'minimumStock' }, { row: 5, code: 'minimumStock' },
      { row: 6, code: 'customNumber', field: 'field:field-cost' }, { row: 7, code: 'customDate', field: 'field:field-expiry' },
    ])
    expect(preview.items).toHaveLength(1)
    expect(preview.items[0]).toMatchObject({ openingBalance: -25, minimumStock: 0, custom: { 'field-cost': '1.25e2', 'field-expiry': '2028-02-29' } })
  })

  it('uses spreadsheet row numbers after empty rows and keeps distinct punctuation in codes', () => {
    const sheet = toTable({ name: 'Sheet1', rows: [['Code', 'Name', 'Unit', 'Opening'], ['A/1', 'Paper', 'box', '1'], [], ['A1', '', 'box', '1']] })
    const preview = buildPreview(sheet, ['code', 'name', 'unit', 'openingBalance'], [], ['A-1'])
    expect(preview.items.map(item => item.code)).toEqual(['A/1'])
    expect(preview.issues).toEqual([{ row: 4, code: 'name' }])
    expect(preview.skipped).toBe(0)
  })

  it('accepts an empty minimum stock and an empty custom value', () => {
    const preview = buildPreview(table([...targets], [['C-1', 'Oil', 'l', '0', '', '', '', '']]), [...mapping], [cost, expires], [])
    expect(preview.issues).toEqual([])
    expect(preview.items[0]).toMatchObject({ openingBalance: 0, minimumStock: null, custom: {} })
  })
})
