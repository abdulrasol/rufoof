import writeXlsxFile from 'write-excel-file/browser'
import { getBalance } from './inventory'
import type { MovementKind, WarehouseData } from './types'

export interface ExportLabels {
  code: string
  name: string
  unit: string
  openingBalance: string
  currentBalance: string
  category: string
  minimumStock: string
  location: string
  notes: string
  date: string
  material: string
  type: string
  quantity: string
  party: string
  document: string
  sheetItems: string
  sheetMovements: string
  kinds: Record<MovementKind, string>
}

export interface ExportSheet {
  name: string
  headers: string[]
  rows: (string | number)[][]
  widths: number[]
}

export function buildExportSheets(data: WarehouseData, labels: ExportLabels): ExportSheet[] {
  const itemFields = data.fields.filter(field => field.target === 'items')
  const movementFields = data.fields.filter(field => field.target === 'movements')
  const unknownItems = Array.from(new Set(data.items.flatMap(item => Object.keys(item.custom))))
    .filter(key => !itemFields.some(field => field.id === key))
  const unknownMovements = Array.from(new Set(data.movements.flatMap(movement => Object.keys(movement.custom))))
    .filter(key => !movementFields.some(field => field.id === key))
  const itemCustom = [
    ...itemFields.map(field => ({ key: field.id, name: field.name })),
    ...unknownItems.map(key => ({ key, name: key })),
  ]
  const movementCustom = [
    ...movementFields.map(field => ({ key: field.id, name: field.name })),
    ...unknownMovements.map(key => ({ key, name: key })),
  ]
  return [
    {
      name: labels.sheetItems,
      headers: [labels.code, labels.name, labels.unit, labels.openingBalance, labels.currentBalance, labels.category, labels.minimumStock, labels.location, labels.notes, ...itemCustom.map(field => field.name)],
      widths: [14, 28, 10, 14, 14, 16, 14, 16, 30, ...itemCustom.map(() => 18)],
      rows: data.items.map(item => [
        item.code, item.name, item.unit, item.openingBalance, getBalance(item, data.movements),
        item.category, item.minimumStock ?? '', item.location, item.notes,
        ...itemCustom.map(field => item.custom[field.key] ?? ''),
      ]),
    },
    {
      name: labels.sheetMovements,
      headers: [labels.date, labels.material, labels.code, labels.type, labels.quantity, labels.party, labels.document, labels.notes, ...movementCustom.map(field => field.name)],
      widths: [13, 28, 14, 12, 12, 20, 20, 30, ...movementCustom.map(() => 18)],
      rows: data.movements.map(movement => {
        const item = data.items.find(entry => entry.id === movement.itemId)
        return [
          movement.date, item?.name ?? movement.itemId, item?.code ?? '', labels.kinds[movement.kind],
          movement.quantity, movement.party, movement.document, movement.notes,
          ...movementCustom.map(field => movement.custom[field.key] ?? ''),
        ]
      }),
    },
  ]
}

export async function downloadWorkbook(fileName: string, sheets: ExportSheet[], rightToLeft: boolean): Promise<void> {
  const data = sheets.map(sheet => ({
    sheet: sheet.name.slice(0, 31),
    rightToLeft,
    columns: sheet.widths.map(width => ({ width })),
    data: [
      sheet.headers.map(header => ({ value: header, fontWeight: 'bold' as const, backgroundColor: '#E6F4EF', align: 'center' as const, wrap: true })),
      ...sheet.rows.map(row => row.map(cell => cell === '' ? null : cell)),
    ],
  }))
  await writeXlsxFile(data, { fontFamily: 'Tahoma', fontSize: 11 }).toFile(fileName)
}
