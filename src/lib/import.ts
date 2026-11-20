import { isValidFieldValue } from './fields'
import type { ImportTable } from './spreadsheet'
import type { CustomField, Item } from './types'

export const CORE_IMPORTS = ['code', 'name', 'unit', 'openingBalance', 'category', 'minimumStock', 'location', 'notes'] as const
export type CoreImport = typeof CORE_IMPORTS[number]
export type ImportTarget = '' | CoreImport | `field:${string}`

export type ImportIssueCode = 'code' | 'name' | 'unit' | 'openingBalance' | 'minimumStock' | 'customNumber' | 'customDate' | 'duplicateCode'

export interface ImportIssue {
  row: number
  code: ImportIssueCode
}

export interface ImportPreview {
  items: Item[]
  issues: ImportIssue[]
  skipped: number
}

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu

const aliases: Record<CoreImport, string[]> = {
  code: ['code', 'itemcode', 'sku', 'reference', 'رمز', 'الكود', 'كود', 'الرمز', 'معرف', 'المعرف'],
  name: ['name', 'item', 'itemname', 'material', 'description', 'اسم', 'الاسم', 'المادة', 'الصنف', 'اسمالمادة', 'الوصف'],
  unit: ['unit', 'uom', 'measure', 'وحدة', 'الوحدة', 'وحدةالقياس'],
  openingBalance: ['openingbalance', 'opening', 'openingstock', 'balance', 'quantity', 'qty', 'stock', 'رصيد', 'الرصيد', 'الرصيدالافتتاحي', 'افتتاحي', 'كمية', 'الكمية', 'المخزون'],
  category: ['category', 'group', 'type', 'تصنيف', 'التصنيف', 'فئة', 'الفئة', 'نوع', 'النوع'],
  minimumStock: ['minimumstock', 'minimum', 'min', 'minstock', 'reorderlevel', 'reorder', 'حدأدنى', 'الحدالأدنى', 'حدالطلب', 'الحد'],
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
    if (!key) return ''
    const core = CORE_IMPORTS.find(name => !used.has(name) && aliases[name].some(alias => normalize(alias) === key))
    if (core) { used.add(core); return core }
    const field = custom.find(entry => !used.has(`field:${entry.id}`) && normalize(entry.name) === key)
    if (field) { const target: ImportTarget = `field:${field.id}`; used.add(target); return target }
    return ''
  })
}

export function mappingProblems(targets: ImportTarget[]): { missing: CoreImport[]; duplicate: string[] } {
  const missing = (['code', 'name', 'unit', 'openingBalance'] as CoreImport[]).filter(target => !targets.includes(target))
  const seen = new Set<string>()
  const duplicate: string[] = []
  for (const target of targets) {
    if (!target) continue
    if (seen.has(target)) duplicate.push(target)
    else seen.add(target)
  }
  return { missing, duplicate: [...new Set(duplicate)] }
}

export function buildPreview(table: ImportTable, targets: ImportTarget[], fields: CustomField[], existingCodes: string[]): ImportPreview {
  const columns = new Map<ImportTarget, number>()
  targets.forEach((target, index) => { if (target && !columns.has(target)) columns.set(target, index) })
  const custom = new Map(fields.filter(field => field.target === 'items').map(field => [`field:${field.id}`, field]))
  const existing = new Set(existingCodes.map(normalize))
  const seen = new Set<string>()
  const items: Item[] = []
  const issues: ImportIssue[] = []
  let skipped = 0

  table.rows.forEach((row, index) => {
    const rowNumber = table.headerRow + index + 2
    const value = (target: ImportTarget) => {
      const column = columns.get(target)
      return column === undefined ? '' : (row[column] ?? '').trim()
    }
    const code = value('code')
    const name = value('name')
    const unit = value('unit')
    const opening = value('openingBalance')
    const minimum = value('minimumStock')
    if (!code) { issues.push({ row: rowNumber, code: 'code' }); return }
    if (!name) { issues.push({ row: rowNumber, code: 'name' }); return }
    if (!unit) { issues.push({ row: rowNumber, code: 'unit' }); return }
    if (!numeric.test(opening) || !Number.isFinite(Number(opening))) { issues.push({ row: rowNumber, code: 'openingBalance' }); return }
    const minimumStock = minimum === '' ? null : Number(minimum)
    if (minimum !== '' && (!numeric.test(minimum) || !Number.isFinite(minimumStock!) || minimumStock! < 0)) {
      issues.push({ row: rowNumber, code: 'minimumStock' }); return
    }
    const customValues: Record<string, string> = {}
    for (const [target, field] of custom) {
      const customValue = value(target)
      if (!customValue) continue
      if (!isValidFieldValue(field.type, customValue)) {
        issues.push({ row: rowNumber, code: field.type === 'number' ? 'customNumber' : 'customDate' })
        return
      }
      customValues[field.id] = customValue
    }
    const key = normalize(code)
    if (existing.has(key)) { skipped += 1; return }
    if (seen.has(key)) { issues.push({ row: rowNumber, code: 'duplicateCode' }); return }
    seen.add(key)
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

  return { items, issues, skipped }
}
