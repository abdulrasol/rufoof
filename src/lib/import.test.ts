import { describe, expect, it } from 'vitest'
import { buildPreview, mappingProblems, suggestTargets } from './import'
import type { CustomField } from './types'

const table = (headers: string[], rows: string[][]) => ({ sheet: 'Sheet1', headerRow: 0, headers, rows })

const cost: CustomField = { id: 'field-cost', name: 'Cost', type: 'number', target: 'items' }
const expires: CustomField = { id: 'field-expiry', name: 'Expiry', type: 'date', target: 'items' }

describe('column mapping', () => {
  it('suggests Arabic and English headers', () => {
    expect(suggestTargets(['الرمز', 'الاسم', 'الوحدة', 'الرصيد الافتتاحي', 'الحد الأدنى']))
      .toEqual(['code', 'name', 'unit', 'openingBalance', 'minimumStock'])
    expect(suggestTargets(['SKU', 'Item', 'UOM', 'Qty', 'Location']))
      .toEqual(['code', 'name', 'unit', 'openingBalance', 'location'])
  })

  it('suggests registered custom fields by name and does not reuse a target', () => {
    expect(suggestTargets(['Code', 'Name', 'Cost', 'Cost'], [cost])).toEqual(['code', 'name', 'field:field-cost', ''])
  })

  it('reports missing required and duplicate targets', () => {
    expect(mappingProblems(['code', 'code', '', 'openingBalance'])).toEqual({
      missing: ['name', 'unit'], duplicate: ['code'],
    })
  })
})

describe('import preview', () => {
  const targets = ['code', 'name', 'unit', 'openingBalance', 'minimumStock', 'category', 'Cost', 'Expiry'] as const
  const mapping = ['code', 'name', 'unit', 'openingBalance', 'minimumStock', 'category', 'field:field-cost', 'field:field-expiry'] as const

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
        ['C-1', 'Duplicate', 'box', '5', '', '', '', ''],
        ['A-2', 'Pens', 'box', '5', '', '', '', ''],
        ['A-3', 'Ink', 'box', '5', '', '', '', ''],
      ]),
      [...mapping], [cost, expires], ['A-1', ' A-3 '],
    )
    expect(preview.skipped).toBe(2)
    expect(preview.items.map(item => item.code)).toEqual(['C-1', 'A-2'])
    expect(preview.issues).toEqual([{ row: 4, code: 'duplicateCode' }])
  })

  it('reports missing required values and invalid numbers or dates', () => {
    const preview = buildPreview(
      table([...targets], [
        ['', 'Paper', 'box', '1', '', '', '', ''],
        ['B-1', '', 'box', '1', '', '', '', ''],
        ['B-2', 'Pens', '', '1', '', '', '', ''],
        ['B-3', 'Ink', 'box', '1.2.3', '', '', '', ''],
        ['B-4', 'Tape', 'roll', '-2', '', '', '', ''],
        ['B-5', 'Glue', 'tube', '1', '', '', 'abc', ''],
        ['B-6', 'Glue', 'tube', '1', '', '', '', '2027-13-01'],
      ]),
      [...mapping], [cost, expires], [],
    )
    expect(preview.items).toHaveLength(0)
    expect(preview.issues).toEqual([
      { row: 2, code: 'code' }, { row: 3, code: 'name' }, { row: 4, code: 'unit' },
      { row: 5, code: 'openingBalance' }, { row: 6, code: 'minimumStock' },
      { row: 7, code: 'customNumber' }, { row: 8, code: 'customDate' },
    ])
  })

  it('accepts an empty minimum stock and an empty custom value', () => {
    const preview = buildPreview(table([...targets], [['C-1', 'Oil', 'l', '0', '', '', '', '']]), [...mapping], [cost, expires], [])
    expect(preview.issues).toEqual([])
    expect(preview.items[0]).toMatchObject({ openingBalance: 0, minimumStock: null, custom: {} })
  })
})
