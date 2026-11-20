import { describe, expect, it } from 'vitest'
import { buildExportSheets } from './excel'
import type { ExportLabels } from './excel'
import type { WarehouseData } from './types'

const labels: ExportLabels = {
  code: 'Code', name: 'Material', unit: 'Unit', openingBalance: 'Opening', currentBalance: 'Balance',
  category: 'Category', minimumStock: 'Minimum', location: 'Location', notes: 'Notes',
  date: 'Date', type: 'Type', quantity: 'Quantity', party: 'Party', document: 'Document',
  kinds: { in: 'In', out: 'Out', adjustment: 'Adjustment' },
}

const data: WarehouseData = {
  fields: [{ id: 'field-color', name: 'Color', type: 'text', target: 'items' }],
  items: [
    { id: 'i1', code: 'A-1', name: 'Paper', unit: 'box', openingBalance: 10, category: 'Office', minimumStock: 2, location: 'A1', notes: 'n', custom: { 'field-color': 'White', unknown: 'kept' } },
  ],
  movements: [
    { id: 'm1', itemId: 'i1', date: '2026-11-20', kind: 'in', quantity: 5, party: 'P', document: 'D', notes: '', custom: {} },
    { id: 'm2', itemId: 'i1', date: '2026-11-21', kind: 'out', quantity: 3, party: '', document: '', notes: '', custom: {} },
  ],
}

describe('Excel export', () => {
  it('builds materials and movements sheets with balances and custom fields', () => {
    const [materials, movements] = buildExportSheets(data, labels)
    expect(materials.name).toBe('Material')
    expect(materials.headers).toEqual(['Code', 'Material', 'Unit', 'Opening', 'Balance', 'Category', 'Minimum', 'Location', 'Notes', 'Color', 'unknown'])
    expect(materials.rows[0]).toEqual(['A-1', 'Paper', 'box', 10, 12, 'Office', 2, 'A1', 'n', 'White', 'kept'])

    expect(movements.name).toBe('Type')
    expect(movements.rows[0]).toEqual(['2026-11-20', 'Paper', 'A-1', 'In', 5, 'P', 'D', ''])
    expect(movements.rows[1][3]).toBe('Out')
    expect(movements.headers.slice(0, 4)).toEqual(['Date', 'Material', 'Code', 'Type'])
    expect(movements.widths).toHaveLength(movements.headers.length)
  })

  it('builds an empty workbook without throwing', () => {
    const [materials, movements] = buildExportSheets({ items: [], movements: [], fields: [] }, labels)
    expect(materials.rows).toEqual([])
    expect(movements.rows).toEqual([])
    expect(materials.widths).toHaveLength(materials.headers.length)
  })
})
