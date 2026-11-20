import { DEFAULT_REQUIRED_ITEM_FIELDS, isValidFieldValue } from './fields'
import type { ImportTable } from './spreadsheet'
import type { CustomField, Item, ItemRequirement } from './types'

export const CORE_IMPORTS = ['code', 'name', 'unit', 'openingBalance', 'category', 'minimumStock', 'location', 'notes'] as const
export type CoreImport = typeof CORE_IMPORTS[number]
export type ImportTarget = '' | CoreImport | `field:${string}`

export type ImportIssueCode = 'code' | 'name' | 'unit' | 'openingBalance' | 'minimumStock' | 'customNumber' | 'customDate' | 'duplicateCode' | 'required'

export interface ImportIssue {
  row: number
  code: ImportIssueCode
  field?: ItemRequirement
}

export interface ImportPreview {
  items: Item[]
  issues: ImportIssue[]
  skipped: number
  existingRows: number[]
}

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu

const aliases: Record<CoreImport, string[]> = {
  code: ['code', 'itemcode', 'sku', 'reference', 'رمز', 'الكود', 'كود', 'الرمز', 'معرف', 'المعرف'],
  name: ['name', 'item', 'itemname', 'material', 'description', 'اسم', 'الاسم', 'المادة', 'الصنف', 'اسمالمادة', 'الوصف'],
  unit: ['unit', 'uom', 'measure', 'وحدة', 'الوحدة', 'وحدةالقياس'],
  openingBalance: ['openingbalance', 'opening', 'openingstock', 'balance', 'quantity', 'qty', 'stock', 'رصيد', 'الرصيد', 'الرصيدالافتتاحي', 'افتتاحي', 'كمية', 'الكمية', 'المخزون'],
  category: ['category', 'group', 'type', 'تصنيف', 'التصنيف', 'فئة', 'الفئة', 'نوع', 'النوع'],
  minimumStock: ['minimumstock', 'minimum', 'min', 'minstock', 'reorderlevel', 'reorder', 'حدأدنى', 'الحدالأدنى', 'الحدالأدنىللمخزون', 'حدالطلب', 'الحد'],
  location: ['location', 'shelf', 'rack', 'position', 'موقع', 'الموقع', 'رف', 'الرف', 'مكان', 'المكان'],
  notes: ['notes', 'note', 'remarks', 'comment', 'ملاحظات', 'ملاحظة', 'تعليق', 'تعليقات'],
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-/\\]+/gu, '')
}

export function suggestTargets(headers: string[], fields: CustomField[] = []): ImportTarget[] {
  const used = new Set<ImportTarget>()
  const custom = fields.filter(field => field.target === 'items')
  return headers.map(header => {
    const key = normalize(header)
    if (!key || headers.filter(entry => normalize(entry) === key).length > 1) return ''
    const candidates: ImportTarget[] = [
      ...CORE_IMPORTS.filter(name => aliases[name].some(alias => normalize(alias) === key)),
      ...custom.filter(field => normalize(field.name) === key).map((field): ImportTarget => `field:${field.id}`),
    ]
    if (candidates.length !== 1 || used.has(candidates[0])) return ''
    used.add(candidates[0])
    return candidates[0]
  })
}

export function mappingProblems(targets: ImportTarget[], requiredFields: readonly ItemRequirement[] = DEFAULT_REQUIRED_ITEM_FIELDS): { missing: ItemRequirement[]; duplicate: string[] } {
  const missing = requiredFields.filter(target => !targets.includes(target))
  const seen = new Set<string>()
  const duplicate: string[] = []
  for (const target of targets) {
    if (!target) continue
    if (seen.has(target)) duplicate.push(target)
    else seen.add(target)
  }
  return { missing, duplicate: [...new Set(duplicate)] }
}

export function editImportTable(table: ImportTable, edits: Readonly<Record<number, Readonly<Record<number, string>>>>, skippedRows: ReadonlySet<number>): ImportTable {
  const rows: string[][] = []
  const rowNumbers: number[] = []
  table.rowNumbers.forEach((rowNumber, index) => {
    if (skippedRows.has(rowNumber)) return
    const changes = edits[rowNumber]
    rows.push(changes ? table.rows[index].map((value, column) => changes[column] ?? value) : table.rows[index])
    rowNumbers.push(rowNumber)
  })
  return { ...table, rows, rowNumbers }
}

export function buildPreview(table: ImportTable, targets: ImportTarget[], fields: CustomField[], existingCodes: string[], requiredFields: readonly ItemRequirement[] = DEFAULT_REQUIRED_ITEM_FIELDS): ImportPreview {
  const columns = new Map<ImportTarget, number>()
  targets.forEach((target, index) => { if (target && !columns.has(target)) columns.set(target, index) })
  const custom = new Map<`field:${string}`, CustomField>(fields.filter(field => field.target === 'items').map(field => [`field:${field.id}`, field] as const))
  const normalizeCode = (value: string) => value.trim().toLowerCase()
  const existing = new Set(existingCodes.map(normalizeCode).filter(Boolean))
  const seen = new Set<string>()
  const items: Item[] = []
  const issues: ImportIssue[] = []
  const existingRows: number[] = []

  table.rows.forEach((row, index) => {
    const rowNumber = table.rowNumbers[index]
    const value = (target: ImportTarget) => {
      const column = columns.get(target)
      return column === undefined ? '' : (row[column] ?? '').trim()
    }
    const code = value('code')
    const name = value('name')
    const unit = value('unit')
    const opening = value('openingBalance')
    const minimum = value('minimumStock')
    for (const target of requiredFields) {
      if (value(target)) continue
      if (target === 'code' || target === 'name' || target === 'unit') issues.push({ row: rowNumber, code: target })
      else issues.push({ row: rowNumber, code: 'required', field: target })
      return
    }
    if (opening !== '' && (!numeric.test(opening) || !Number.isFinite(Number(opening)))) { issues.push({ row: rowNumber, code: 'openingBalance' }); return }
    const minimumStock = minimum === '' ? null : Number(minimum)
    if (minimum !== '' && (!numeric.test(minimum) || !Number.isFinite(minimumStock!) || minimumStock! < 0)) {
      issues.push({ row: rowNumber, code: 'minimumStock' }); return
    }
    const customValues: Record<string, string> = {}
    for (const [target, field] of custom) {
      const customValue = value(target)
      if (!customValue) continue
      if (!isValidFieldValue(field.type, customValue)) {
        issues.push({ row: rowNumber, code: field.type === 'number' ? 'customNumber' : 'customDate', field: target })
        return
      }
      customValues[field.id] = customValue
    }
    const key = normalizeCode(code)
    if (key) {
      if (existing.has(key)) { existingRows.push(rowNumber); return }
      if (seen.has(key)) { issues.push({ row: rowNumber, code: 'duplicateCode' }); return }
      seen.add(key)
    }
    items.push({
      id: crypto.randomUUID(),
      code, name, unit,
      openingBalance: Number(opening),
      category: value('category'),
      minimumStock,
      location: value('location'),
      notes: value('notes'),
      custom: customValues,
    })
  })

  return { items, issues, skipped: existingRows.length, existingRows }
}
