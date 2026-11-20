import readXlsxFile from 'read-excel-file/browser'

export interface ImportSheet {
  name: string
  rows: string[][]
}

export interface ImportTable {
  sheet: string
  headerRow: number
  headers: string[]
  rows: string[][]
}

export type SpreadsheetErrorCode = 'unsupported' | 'empty' | 'tooLarge' | 'unreadable'

export class SpreadsheetError extends Error {
  constructor(readonly code: SpreadsheetErrorCode) {
    super(code)
    this.name = 'SpreadsheetError'
  }
}

const MAX_ROWS = 5000
const MAX_COLUMNS = 64

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    // Excel date cells carry no timezone; read the UTC parts to avoid a day shift.
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return String(value).trim()
}

export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1 }
        else quoted = false
      } else field += char
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field); field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field); rows.push(row); row = []; field = ''
    } else field += char
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

export async function readSpreadsheet(file: File): Promise<ImportSheet[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) {
    const sheets = [{ name: file.name, rows: parseCsv(await file.text()) }]
    for (const sheet of sheets) guard(sheet)
    return sheets
  }
  if (!name.endsWith('.xlsx')) throw new SpreadsheetError('unsupported')
  let parsed: Array<{ sheet: string; data: unknown[][] }>
  try {
    parsed = await readXlsxFile(file) as unknown as Array<{ sheet: string; data: unknown[][] }>
  } catch {
    throw new SpreadsheetError('unreadable')
  }
  const sheets = parsed.map(sheet => ({ name: sheet.sheet, rows: sheet.data.map(row => row.map(cellText)) }))
    .filter(sheet => sheet.rows.some(row => row.some(value => value !== '')))
  if (!sheets.length) throw new SpreadsheetError('empty')
  for (const sheet of sheets) guard(sheet)
  return sheets
}

function guard(sheet: ImportSheet): void {
  if (sheet.rows.length > MAX_ROWS + 1) throw new SpreadsheetError('tooLarge')
  if (sheet.rows.some(row => row.length > MAX_COLUMNS)) throw new SpreadsheetError('tooLarge')
}

export function toTable(sheet: ImportSheet): ImportTable {
  const headerRow = sheet.rows.findIndex(row => row.some(value => value.trim() !== ''))
  if (headerRow < 0) throw new SpreadsheetError('empty')
  const width = Math.max(1, ...sheet.rows.map(row => {
    let last = -1
    row.forEach((value, index) => { if (value.trim() !== '') last = index })
    return last + 1
  }))
  if (width > MAX_COLUMNS) throw new SpreadsheetError('tooLarge')
  const headers = Array.from({ length: width }, (_, index) => (sheet.rows[headerRow]?.[index] ?? '').trim())
  const rows = sheet.rows.slice(headerRow + 1)
    .filter(row => row.some(value => value.trim() !== ''))
    .map(row => Array.from({ length: width }, (_, index) => (row[index] ?? '').trim()))
  if (rows.length > MAX_ROWS) throw new SpreadsheetError('tooLarge')
  return { sheet: sheet.name, headerRow, headers, rows }
}
