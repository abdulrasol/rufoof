import { movementDelta } from './inventory'
import { DEFAULT_REQUIRED_ITEM_FIELDS, FieldValueError, isIsoDate, isValidFieldValue, missingItemRequirements, validateItemRequirements } from './fields'
import { REPAIRABLE_CORE, SchemaIssueError, WorkbookDataError } from './schema'
import type { CustomField, FieldTarget, FieldType, GoogleSession, InventoryRepository, Item, ItemRequirement, Movement, WarehouseData, WorkbookRef } from './types'

export { WorkbookDataError } from './schema'

const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email profile'
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const META_KEY = 'rufoof.column'

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string }
type Gis = { accounts: { oauth2: { initTokenClient: (options: {
  client_id: string; scope: string; prompt?: string; login_hint?: string; callback: (response: TokenResponse) => void
  error_callback: (error: { type?: string; message?: string }) => void
}) => { requestAccessToken: () => void } } } }
const SILENT_TIMEOUT_MS = 10_000
const OAUTH_STATE_KEY = 'rufoof-google-oauth-state'
let gisLoading: Promise<Gis> | undefined

function loadGis(): Promise<Gis> {
  const existing = (window as Window & { google?: Gis }).google
  if (existing?.accounts?.oauth2) return Promise.resolve(existing)
  if (!gisLoading) {
    gisLoading = new Promise<Gis>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = () => {
        const google = (window as Window & { google?: Gis }).google
        if (google?.accounts?.oauth2) resolve(google)
        else reject(new Error('Google Identity Services did not initialize'))
      }
      script.onerror = () => reject(new Error('Could not load Google Identity Services'))
      document.head.appendChild(script)
    }).catch(error => { gisLoading = undefined; throw error })
  }
  return gisLoading
}

function requireGesture(): void {
  if (navigator.userActivation && !navigator.userActivation.isActive) {
    throw new Error('Sign in must be initiated by a user gesture. Please click Sign in again.')
  }
}

async function requestSession(interactive: boolean, loginHint?: string): Promise<GoogleSession> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('Set VITE_GOOGLE_CLIENT_ID to sign in with Google')
  const google = await loadGis()
  // Loading the script can outlast transient browser activation. Never open a popup
  // without it; a second click can use the already-loaded script.
  if (interactive) requireGesture()
  const token = await new Promise<TokenResponse>((resolve, reject) => {
    const timer = interactive ? undefined : setTimeout(() => reject(new Error('Silent Google sign-in timed out')), SILENT_TIMEOUT_MS)
    const settle = (action: () => void) => { if (timer !== undefined) clearTimeout(timer); action() }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: interactive ? '' : 'none',
      ...(loginHint ? { login_hint: loginHint } : {}),
      callback: response => settle(() => resolve(response)),
      error_callback: error => settle(() => reject(new Error(`Google sign-in failed: ${error.message || error.type || 'popup closed'}`))),
    })
    client.requestAccessToken()
  })
  if (token.error || !token.access_token || !token.expires_in || token.expires_in <= 0) {
    throw new Error(`Google sign-in failed: ${token.error_description || token.error || 'no access token'}`)
  }
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store',
  })
  if (response.status === 401) throw new Error('Google authorization expired. Please sign in again.')
  if (!response.ok) throw new Error(`Could not retrieve Google account information (${response.status})`)
  const user = await response.json() as { sub?: string; email?: string; name?: string }
  if (!user.sub || !user.email) throw new Error('Google did not return an account ID and email')
  return { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000, accountId: user.sub, email: user.email, name: user.name || user.email }
}

export async function authorizeGoogle(): Promise<GoogleSession> {
  requireGesture()
  return requestSession(true)
}

export function beginGoogleAuthorization(): void {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('Set VITE_GOOGLE_CLIENT_ID to sign in with Google')
  const redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI || `${window.location.origin}/auth/google/callback`
  const state = crypto.randomUUID()
  sessionStorage.setItem(OAUTH_STATE_KEY, state)
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: SCOPE, state })
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}

export function consumeGoogleAuthorizationCallback(): { code: string; redirectUri: string } | null {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code && !url.searchParams.get('error')) return null
  if (url.searchParams.get('error')) throw new Error(`Google sign-in failed: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`)
  if (!code || !state || state !== sessionStorage.getItem(OAUTH_STATE_KEY)) throw new Error('Google authorization response could not be verified')
  sessionStorage.removeItem(OAUTH_STATE_KEY)
  window.history.replaceState({}, document.title, `/${url.hash}`)
  return { code, redirectUri: import.meta.env.VITE_GOOGLE_REDIRECT_URI || `${window.location.origin}/auth/google/callback` }
}

// Best-effort restore without a click. Browsers may require user activation, so callers
// must fall back to the interactive flow when this rejects.
export async function authorizeGoogleSilently(loginHint?: string): Promise<GoogleSession> {
  return requestSession(false, loginHint)
}

class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly uncertain = false) { super(message) }
}

export class WorkbookDiscoveryError extends Error {
  constructor() {
    super('Column metadata write outcome is uncertain. Inspect the workbook before trying again.')
    this.name = 'WorkbookDiscoveryError'
  }
}

// Keep API calls and metadata discovery outside these synchronous validation boundaries.
function validateWorkbookData<T>(classify: boolean, validate: () => T): T {
  try { return validate() } catch (error) {
    if (error instanceof SchemaIssueError) {
      if (!classify) throw error
      throw new WorkbookDataError([error.issue])
    }
    if (classify) throw new WorkbookDataError([{ code: 'unknownData' }])
    throw error
  }
}

type CellValue = { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string; errorValue?: { message?: string } }
type Cell = { userEnteredValue?: CellValue; effectiveValue?: CellValue }
type Grid = { startRow?: number; startColumn?: number; rowData?: Array<{ values?: Cell[] }> }
type Sheet = { properties: { sheetId: number; title: string; gridProperties?: { columnCount?: number } }; data?: Grid[] }
type Metadata = { metadataId?: number; metadataKey: string; metadataValue?: string; location?: { dimensionRange?: { sheetId?: number; dimension?: string; startIndex?: number; endIndex?: number } } }
type ColumnMeta = { v: 1; kind: 'core' | 'field'; id: string; name?: string; type?: FieldType; required?: boolean }
type Column = { index: number; meta: ColumnMeta; header: string; metadata?: { id?: number; value: string } }
type Table = { sheet: Sheet; rows: Map<number, Map<number, Cell>>; columns: Column[]; core: Map<string, Column> }
type State = { data: WarehouseData; tables: Record<FieldTarget, Table>; itemRows: Map<string, number> }

const CORE: Record<FieldTarget, Array<{ id: string; header: string }>> = {
  items: [
    { id: 'id', header: 'ID' }, { id: 'code', header: 'Code' }, { id: 'name', header: 'Name' },
    { id: 'unit', header: 'Unit' }, { id: 'openingBalance', header: 'Opening Balance' },
    { id: 'category', header: 'Category' }, { id: 'minimumStock', header: 'Minimum Stock' },
    { id: 'location', header: 'Location' }, { id: 'notes', header: 'Notes' },
  ],
  movements: [
    { id: 'id', header: 'ID' }, { id: 'itemId', header: 'Item ID' }, { id: 'date', header: 'Date' },
    { id: 'kind', header: 'Kind' }, { id: 'quantity', header: 'Quantity' },
    { id: 'party', header: 'Party' }, { id: 'document', header: 'Document' }, { id: 'notes', header: 'Notes' },
  ],
}

function itemRequirement(column: Column): ItemRequirement | undefined {
  if (column.meta.kind === 'field') return `field:${column.meta.id}`
  return column.meta.id === 'id' ? undefined : column.meta.id as ItemRequirement
}

function columnIsRequired(column: Column): boolean {
  const identity = itemRequirement(column)
  return column.meta.required ?? (identity !== undefined && DEFAULT_REQUIRED_ITEM_FIELDS.includes(identity))
}

const normalized = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/gu, '')
const quoteSheet = (title: string) => `'${title.replace(/'/gu, "''")}'`
function columnLetter(index: number): string {
  let n = index + 1, result = ''
  while (n > 0) { n--; result = String.fromCharCode(65 + n % 26) + result; n = Math.floor(n / 26) }
  return result
}
function cellValue(cell?: Cell): string | number | boolean | '' {
  if (!cell) return ''
  const value = cell.effectiveValue ?? (cell.userEnteredValue?.formulaValue ? undefined : cell.userEnteredValue)
  if (!value && cell.userEnteredValue?.formulaValue) throw new Error('A formula has no effective value; fix it in Google Sheets')
  if (value?.errorValue) throw new Error(`A spreadsheet formula has an error: ${value.errorValue.message || 'unknown error'}`)
  return value?.stringValue ?? value?.numberValue ?? value?.boolValue ?? ''
}
const text = (cell?: Cell) => String(cellValue(cell))
function number(cell: Cell | undefined, label: string, optional = false): number | null {
  const value = cellValue(cell)
  if (value === '' && optional) return null
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim()))) {
    throw new Error(`Invalid ${label}; use a locale-independent number`)
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`)
  return parsed
}
function validDate(value: string): boolean {
  return isIsoDate(value)
}
function metadataRequest(sheetId: number, index: number, meta: ColumnMeta) {
  return { createDeveloperMetadata: { developerMetadata: {
    metadataKey: META_KEY, metadataValue: JSON.stringify(meta), visibility: 'DOCUMENT',
    location: { dimensionRange: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 } },
  } } }
}
function checkField(field: CustomField): void {
  if (!field.id || !field.name.trim() || !['items', 'movements'].includes(field.target) || !['text', 'number', 'date'].includes(field.type)) throw new Error('Invalid custom field')
}
function checkItem(item: Item): void {
  if (typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim() || !Number.isFinite(item.openingBalance) || (item.minimumStock !== null && !Number.isFinite(item.minimumStock))) throw new Error('Invalid item ID, name, or stock quantity')
  if (typeof item.code !== 'string' || typeof item.unit !== 'string' || typeof item.category !== 'string' || typeof item.location !== 'string' || typeof item.notes !== 'string' || !item.custom) throw new Error('Invalid item fields')
}
function checkMovement(movement: Movement, itemIds: Set<string>): void {
  if (typeof movement.id !== 'string' || !movement.id.trim() || !itemIds.has(movement.itemId)) throw new Error(`Invalid movement ID or unknown item reference: ${movement.id}`)
  if (typeof movement.date !== 'string' || !validDate(movement.date)) throw new Error(`Invalid movement date: ${movement.id}; use ISO format`)
  if (typeof movement.party !== 'string' || typeof movement.document !== 'string' || typeof movement.notes !== 'string' || !movement.custom) throw new Error(`Invalid movement fields: ${movement.id}`)
  movementDelta(movement)
}
function checkCustom(fields: CustomField[], target: FieldTarget, custom: Record<string, string>) {
  for (const [id, value] of Object.entries(custom)) {
    if (typeof value !== 'string' || !fields.some(field => field.id === id && field.target === target)) throw new Error(`Unknown or invalid custom field: ${id}`)
  }
}

export function googleRepository(session: GoogleSession): InventoryRepository {
  // A loaded baseline distinguishes an edit from a stale value changed elsewhere.
  const baselines = new Map<string, WarehouseData>()
  const discoveries = new Map<string, Promise<void>>()
  const blockedDiscoveries = new Set<string>()
  async function api<T>(url: string, init: RequestInit = {}, write = false): Promise<T> {
    if (write && typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('Cannot write while offline')
    if (!session.accessToken || Date.now() >= session.expiresAt) throw new ApiError('Google authorization expired. Please sign in again.', 401)
    let response: Response
    try {
      response = await fetch(url, {
        ...init, cache: 'no-store',
        headers: { Authorization: `Bearer ${session.accessToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      })
    } catch {
      throw new ApiError(write ? 'Network error: the write outcome is uncertain; check the workbook before trying again.' : 'Network error while reading Google data.', undefined, write)
    }
    if (response.status === 401) throw new ApiError('Google authorization expired or was revoked. Please sign in again.', 401)
    if (!response.ok) {
      let detail = ''
      try { const body = await response.json() as { error?: { message?: string } }; detail = body.error?.message || '' } catch { /* No structured error body. */ }
      throw new ApiError(`Google API error (${response.status})${detail ? `: ${detail}` : ''}${write && response.status >= 500 ? '. The write outcome may be uncertain.' : ''}`, response.status, write && response.status >= 500)
    }
    try { return await response.json() as T } catch {
      throw new ApiError(write ? 'The write response was unreadable; its outcome is uncertain.' : 'The Google response was unreadable.', response.status, write)
    }
  }
  const url = (id: string) => `${SHEETS}/${encodeURIComponent(id)}`
  const batch = (id: string, requests: unknown[]) => api<unknown>(`${url(id)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) }, true)

  async function updateColumnMetadata(id: string, changes: Array<{ column: Column; meta: ColumnMeta }>): Promise<void> {
    if (!changes.length) return
    const updates = changes.map(({ column, meta }) => {
      const original = column.metadata
      if (!original || !Number.isInteger(original.id) || original.id! < 0) throw new Error('Column metadata ID is missing or invalid; reload the ledger before editing.')
      const value = JSON.stringify(meta)
      return {
        id: original.id!, value,
        request: { updateDeveloperMetadata: {
          dataFilters: [{ developerMetadataLookup: { metadataId: original.id, metadataValue: original.value } }],
          developerMetadata: { metadataValue: value }, fields: 'metadataValue',
        } },
      }
    })
    if (new Set(updates.map(update => update.id)).size !== updates.length) throw new Error('Duplicate column metadata IDs; reload the ledger before editing.')
    // ID and the exact old value narrow conflicts, but Sheets does not isolate concurrent collaborators.
    const result = await batch(id, updates.map(update => update.request)) as {
      replies?: Array<{ updateDeveloperMetadata?: { developerMetadata?: Metadata[] } }>
    }
    if (!Array.isArray(result?.replies) || result.replies.length !== updates.length || updates.some((update, index) => {
      const matched = result.replies![index]?.updateDeveloperMetadata?.developerMetadata
      return !Array.isArray(matched) || matched.length !== 1 || matched[0]?.metadataId !== update.id || matched[0]?.metadataValue !== update.value
    })) throw new Error('Column metadata update was partial, conflicted, or uncertain. Reload the ledger and verify the settings before trying again.')
  }

  async function readState(id: string, discover = true, classifyDataErrors = false): Promise<State> {
    const fields = 'sheets(properties(sheetId,title,gridProperties(columnCount)),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue))))'
    const [spreadsheet, found] = await Promise.all([
      api<{ sheets?: Sheet[] }>(`${url(id)}?includeGridData=true&fields=${encodeURIComponent(fields)}`),
      api<{ matchedDeveloperMetadata?: Array<{ developerMetadata: Metadata }> }>(`${url(id)}/developerMetadata:search`, {
        method: 'POST', body: JSON.stringify({ dataFilters: [{ developerMetadataLookup: { metadataKey: META_KEY } }] }),
      }),
    ])
    const { tables, pending } = validateWorkbookData(classifyDataErrors, () => {
      const tables = {} as Record<FieldTarget, Table>
      const pending: Array<{ sheetId: number; index: number; meta: ColumnMeta }> = []
      const fieldIds = new Set<string>()
      for (const target of ['items', 'movements'] as const) {
        const matches = (spreadsheet.sheets || []).filter(sheet => sheet.properties.title.toLowerCase() === target)
        if (matches.length !== 1) throw new SchemaIssueError({ code: 'sheetCount', target })
        const sheet = matches[0]
        const width = sheet.properties.gridProperties?.columnCount
        if (!width || !Number.isInteger(width)) throw new SchemaIssueError({ code: 'sheetDimensions', target })
        const rows = new Map<number, Map<number, Cell>>()
        for (const grid of sheet.data || []) {
          for (const [rowOffset, row] of (grid.rowData || []).entries()) {
            const rowIndex = (grid.startRow || 0) + rowOffset
            for (const [colOffset, cell] of (row.values || []).entries()) {
              if (!cell.userEnteredValue && !cell.effectiveValue) continue
              const col = (grid.startColumn || 0) + colOffset
              if (!rows.has(rowIndex)) rows.set(rowIndex, new Map())
              rows.get(rowIndex)!.set(col, cell)
            }
          }
        }
        const header = rows.get(0) || new Map<number, Cell>()
        const seenHeaders = new Set<string>()
        for (const [col, cell] of header) {
          const value = normalized(text(cell))
          if (value && seenHeaders.has(value)) throw new SchemaIssueError({ code: 'duplicateHeader', target, column: columnLetter(col), header: text(cell) })
          if (value) seenHeaders.add(value)
        }
        const byIndex = new Map<number, { meta: ColumnMeta; metadata: Column['metadata'] }>()
        const columnName = (index: unknown) => typeof index === 'number' && Number.isInteger(index) && index >= 0 ? columnLetter(index) : undefined
        for (const match of found.matchedDeveloperMetadata || []) {
          const metadata = match.developerMetadata
          const range = metadata.location?.dimensionRange
          if (range?.sheetId !== sheet.properties.sheetId) continue
          const index = range.startIndex
          if (range.dimension !== 'COLUMNS' || index === undefined || !Number.isInteger(index) || index < 0 || index >= width || range.endIndex !== index + 1) throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) })
          if (byIndex.has(index)) throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) })
          let meta: ColumnMeta
          try { meta = JSON.parse(metadata.metadataValue || '') as ColumnMeta } catch { throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) }) }
          if (meta?.v !== 1 || typeof meta.id !== 'string' || !meta.id || (meta.kind !== 'core' && meta.kind !== 'field')) throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) })
          if (meta.kind === 'core' && !CORE[target].some(core => core.id === meta.id)) throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) })
          if (meta.kind === 'field' && (typeof meta.name !== 'string' || !meta.name.trim() || !['text', 'number', 'date'].includes(meta.type || ''))) throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) })
          if ((Object.hasOwn(meta, 'required') && typeof meta.required !== 'boolean') ||
            (target === 'items' && meta.kind === 'core' && ((meta.id === 'name' && meta.required === false) || (meta.id === 'id' && meta.required === true)))) {
            throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) })
          }
          byIndex.set(index, { meta, metadata: { id: metadata.metadataId, value: metadata.metadataValue! } })
        }
        const columns: Column[] = []
        const core = new Map<string, Column>()
        // Metadata always takes precedence over editable headers.
        for (const [index, { meta, metadata }] of byIndex) {
          const name = text(header.get(index)).trim()
          if (!name) throw new SchemaIssueError({ code: 'columnMetadata', target, column: columnName(index) })
          const column = { index, meta, header: name, metadata }
          if (meta.kind === 'core') {
            if (core.has(meta.id)) throw new SchemaIssueError({ code: 'duplicateCore', target, column: columnName(index), coreId: meta.id })
            core.set(meta.id, column)
          } else {
            if (fieldIds.has(meta.id)) throw new SchemaIssueError({ code: 'duplicateField', target, column: columnName(index) })
            fieldIds.add(meta.id)
          }
          columns.push(column)
        }
        for (const [index, cell] of header) {
          if (byIndex.has(index)) continue
          const name = text(cell).trim()
          if (!name) continue
          const known = CORE[target].find(candidate => normalized(candidate.id) === normalized(name) || normalized(candidate.header) === normalized(name))
          let meta: ColumnMeta
          if (known) {
            if (core.has(known.id)) throw new SchemaIssueError({ code: 'ambiguousCore', target, column: columnName(index), header: name })
            meta = { v: 1, kind: 'core', id: known.id }
          } else {
            meta = { v: 1, kind: 'field', id: crypto.randomUUID(), name, type: 'text' }
            if (fieldIds.has(meta.id)) throw new SchemaIssueError({ code: 'duplicateField', target, column: columnName(index) })
            fieldIds.add(meta.id)
          }
          const column = { index, meta, header: name }
          columns.push(column)
          if (meta.kind === 'core') core.set(meta.id, column)
          pending.push({ sheetId: sheet.properties.sheetId, index, meta })
        }
        for (const required of CORE[target]) if (!core.has(required.id)) throw new SchemaIssueError({ code: 'missingCore', target, coreId: required.id, header: required.header })
        for (const [rowIndex, row] of rows) {
          if (rowIndex === 0) continue
          for (const [index, cell] of row) {
            if (!columns.some(column => column.index === index) && (cell.userEnteredValue?.formulaValue || cellValue(cell) !== '')) {
              throw new SchemaIssueError({ code: 'dataWithoutHeader', target, column: columnLetter(index) })
            }
          }
        }
        tables[target] = { sheet, rows, columns: columns.sort((a, b) => a.index - b.index), core }
      }
      return { tables, pending }
    })
    if (pending.length) {
      if (!discover || blockedDiscoveries.has(id)) throw new WorkbookDiscoveryError()
      const ongoing = discoveries.get(id)
      if (ongoing) { await ongoing; return readState(id, true, classifyDataErrors) }
      const discovery = (async () => {
        try {
          await batch(id, pending.map(({ sheetId, index, meta }) => metadataRequest(sheetId, index, meta)))
        } catch (error) {
          if (!(error instanceof ApiError) || !error.uncertain) throw error
          try {
            const verified = await readState(id, false)
            if (pending.every(({ sheetId, index, meta }) => Object.values(verified.tables).some(table => table.sheet.properties.sheetId === sheetId && table.columns.some(column => column.index === index && column.meta.id === meta.id && column.meta.kind === meta.kind)))) return
          } catch { /* Verification itself can fail; do not repeat the write. */ }
          blockedDiscoveries.add(id)
          throw new WorkbookDiscoveryError()
        }
      })()
      discoveries.set(id, discovery)
      try { await discovery } finally { if (discoveries.get(id) === discovery) discoveries.delete(id) }
      // Re-read rather than assuming no other device attached metadata concurrently.
      return readState(id, false, classifyDataErrors)
    }
    blockedDiscoveries.delete(id)
    return validateWorkbookData(classifyDataErrors, () => {
      const data: WarehouseData = { items: [], movements: [], fields: [], requiredItemFields: [] }
      for (const target of ['items', 'movements'] as const) {
        for (const column of tables[target].columns) if (column.meta.kind === 'field') {
          data.fields.push({ id: column.meta.id, name: column.header, type: column.meta.type!, target })
        }
      }
      for (const column of tables.items.columns) {
        const identity = itemRequirement(column)
        if (identity && columnIsRequired(column)) data.requiredItemFields!.push(identity)
      }
      validateItemRequirements(data.requiredItemFields!, data.fields)
      const itemRows = new Map<string, number>()
      const customFor = (table: Table, row: Map<number, Cell>) => Object.fromEntries(table.columns.filter(column => column.meta.kind === 'field').map(column => [column.meta.id, text(row.get(column.index))]))
      const get = (table: Table, row: Map<number, Cell>, key: string) => row.get(table.core.get(key)!.index)
      const nonempty = (row: Map<number, Cell>) => [...row.values()].some(cell => !!cell.userEnteredValue?.formulaValue || cellValue(cell) !== '')
      const items = tables.items
      for (const [index, row] of [...items.rows].sort((a, b) => a[0] - b[0])) {
        if (index === 0 || !nonempty(row)) continue
        try {
          const item: Item = {
            id: text(get(items, row, 'id')), code: text(get(items, row, 'code')), name: text(get(items, row, 'name')),
            unit: text(get(items, row, 'unit')), openingBalance: number(get(items, row, 'openingBalance'), `opening balance on items row ${index + 1}`)!,
            category: text(get(items, row, 'category')), minimumStock: number(get(items, row, 'minimumStock'), `minimum stock on items row ${index + 1}`, true),
            location: text(get(items, row, 'location')), notes: text(get(items, row, 'notes')), custom: customFor(items, row),
          }
          checkItem(item)
          if (itemRows.has(item.id)) throw new Error(`Duplicate item ID: ${item.id}`)
          itemRows.set(item.id, index)
          data.items.push(item)
        } catch (error) {
          if (error instanceof SchemaIssueError) throw error
          throw new SchemaIssueError({ code: 'invalidRow', target: 'items', row: index + 1 }, error instanceof Error ? error.message : undefined)
        }
      }
      const movements = tables.movements
      const movementIds = new Set<string>()
      for (const [index, row] of [...movements.rows].sort((a, b) => a[0] - b[0])) {
        if (index === 0 || !nonempty(row)) continue
        try {
          const movement: Movement = {
            id: text(get(movements, row, 'id')), itemId: text(get(movements, row, 'itemId')), date: text(get(movements, row, 'date')),
            kind: text(get(movements, row, 'kind')) as Movement['kind'], quantity: number(get(movements, row, 'quantity'), `quantity on movements row ${index + 1}`)!,
            party: text(get(movements, row, 'party')), document: text(get(movements, row, 'document')), notes: text(get(movements, row, 'notes')), custom: customFor(movements, row),
          }
          checkMovement(movement, new Set(itemRows.keys()))
          if (movementIds.has(movement.id)) throw new Error(`Duplicate movement ID: ${movement.id}`)
          movementIds.add(movement.id)
          data.movements.push(movement)
        } catch (error) {
          if (error instanceof SchemaIssueError) throw error
          throw new SchemaIssueError({ code: 'invalidRow', target: 'movements', row: index + 1 }, error instanceof Error ? error.message : undefined)
        }
      }
      return { data, tables, itemRows }
    })
  }

  function checkRequirements(data: WarehouseData, expected?: readonly ItemRequirement[]): readonly ItemRequirement[] {
    const required = data.requiredItemFields ?? DEFAULT_REQUIRED_ITEM_FIELDS
    if (expected) {
      const actualSet = new Set(required), expectedSet = new Set(expected)
      if (actualSet.size !== expectedSet.size || [...expectedSet].some(field => !actualSet.has(field))) throw new Error('Required fields changed; reload the ledger')
    }
    return required
  }

  function checkRequiredItem(item: Item, required: readonly ItemRequirement[]): void {
    if (missingItemRequirements(item, required).length) throw new Error('Required item fields are missing')
  }

  function rowValues(table: Table, values: Record<string, string | number | null>, custom: Record<string, string>): (string | number | null)[] {
    const last = Math.max(...table.columns.map(column => column.index))
    // null skips a cell in the Sheets values API, unlike an empty string which clears it.
    const row: (string | number | null)[] = Array(last + 1).fill(null)
    for (const column of table.columns) {
      const value = column.meta.kind === 'core' ? values[column.meta.id] : Object.hasOwn(custom, column.meta.id) ? custom[column.meta.id] : null
      row[column.index] = value === '' ? null : value ?? null
    }
    return row
  }
  async function append(id: string, table: Table, rows: (string | number | null)[][]) {
    const range = `${quoteSheet(table.sheet.properties.title)}!A1:${columnLetter(table.sheet.properties.gridProperties!.columnCount! - 1)}`
    await api<unknown>(`${url(id)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: rows }),
    }, true)
  }
  const itemValues = (item: Item): Record<string, string | number | null> => ({ id: item.id, code: item.code, name: item.name, unit: item.unit, openingBalance: item.openingBalance, category: item.category, minimumStock: item.minimumStock, location: item.location, notes: item.notes })
  const movementValues = (movement: Movement): Record<string, string | number | null> => ({ id: movement.id, itemId: movement.itemId, date: movement.date, kind: movement.kind, quantity: movement.quantity, party: movement.party, document: movement.document, notes: movement.notes })
  const same = (a: Item | Movement, b: Item | Movement, fields: CustomField[], target: FieldTarget) => {
    const left = 'openingBalance' in a ? itemValues(a) : movementValues(a)
    const right = 'openingBalance' in b ? itemValues(b) : movementValues(b)
    const customValue = (custom: Record<string, string>, id: string) => Object.hasOwn(custom, id) ? custom[id] : ''
    return Object.keys(left).every(key => left[key] === right[key]) && fields.filter(field => field.target === target).every(field => customValue(a.custom, field.id) === customValue(b.custom, field.id))
  }
  async function verifyAppend(id: string, expected: Array<Item | Movement>, target: FieldTarget): Promise<boolean> {
    try {
      const state = await readState(id, false)
      const actual: Array<Item | Movement> = target === 'items' ? state.data.items : state.data.movements
      return expected.every(value => actual.some(found => found.id === value.id && same(found, value, state.data.fields, target)))
    } catch { return false }
  }

  return {
    async listWorkbooks() {
      const result: WorkbookRef[] = []
      let pageToken: string | undefined
      do {
        const params = new URLSearchParams({ q: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false", fields: 'nextPageToken,files(id,name)', pageSize: '100' })
        if (pageToken) params.set('pageToken', pageToken)
        const page = await api<{ nextPageToken?: string; files?: WorkbookRef[] }>(`https://www.googleapis.com/drive/v3/files?${params}`)
        result.push(...(page.files || []).filter(file => !!file.id && !!file.name))
        pageToken = page.nextPageToken
      } while (pageToken)
      return result
    },
    async createWorkbook(name: string) {
      if (!name.trim()) throw new Error('Workbook name is required')
      const created = await api<{ spreadsheetId: string; properties: { title: string } }>(SHEETS, {
        method: 'POST', body: JSON.stringify({ properties: { title: name.trim() }, sheets: [{ properties: { sheetId: 1, title: 'items' } }, { properties: { sheetId: 2, title: 'movements' } }] }),
      }, true)
      const ref = { id: created.spreadsheetId, name: created.properties.title }
      const requests: unknown[] = []
      for (const [target, sheetId] of [['items', 1], ['movements', 2]] as const) {
        requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: CORE[target].map(column => ({ userEnteredValue: { stringValue: column.header } })) }], fields: 'userEnteredValue' } })
        CORE[target].forEach((column, index) => requests.push(metadataRequest(sheetId, index, { v: 1, kind: 'core', id: column.id })))
      }
      try { await batch(ref.id, requests) } catch (error) {
        const message = `Workbook ${ref.name} (${ref.id}) was created, but initialization failed or is uncertain. Inspect it before creating another. ${error instanceof Error ? error.message : ''}`
        if (error instanceof ApiError) throw new ApiError(message, error.status, error.uncertain)
        throw new Error(message)
      }
      return ref
    },
    async loadWorkbook(id: string) {
      const data = (await readState(id, true, true)).data
      baselines.set(id, structuredClone(data))
      return data
    },
    async saveItem(id: string, item: Item, expectedRequirements?: readonly ItemRequirement[]) {
      const state = await readState(id)
      const required = checkRequirements(state.data, expectedRequirements)
      checkItem(item)
      checkCustom(state.data.fields, 'items', item.custom)
      checkRequiredItem(item, required)
      const table = state.tables.items
      const rowIndex = state.itemRows.get(item.id)
      if (rowIndex === undefined) {
        try { await append(id, table, [rowValues(table, itemValues(item), item.custom)]) } catch (error) {
          if (!(error instanceof ApiError) || !error.uncertain) throw error
          if (!await verifyAppend(id, [item], 'items')) throw new Error('Item append outcome is uncertain. Check its ID in the workbook before retrying; concurrent writes may duplicate it.')
        }
        state.data.items.push(structuredClone(item))
        baselines.set(id, structuredClone(state.data))
        return
      }
      const existing = state.data.items.find(value => value.id === item.id)!
      const baseline = baselines.get(id)?.items.find(value => value.id === item.id)
      if (!baseline) throw new Error('Load the workbook before editing an existing item')
      if (item.openingBalance !== baseline.openingBalance) throw new Error('Opening balance cannot be edited after creation; record a stock-count adjustment instead.')
      const current = itemValues(existing), original = itemValues(baseline), desired = itemValues(item)
      const next = structuredClone(existing)
      const changes: Array<{ range: string; values: (string | number)[][] }> = []
      for (const column of table.columns) {
        let before: string | number | null | undefined, initial: string | number | null | undefined, after: string | number | null | undefined
        if (column.meta.kind === 'core') { before = current[column.meta.id]; initial = original[column.meta.id]; after = desired[column.meta.id] }
        else {
          if (!Object.hasOwn(item.custom, column.meta.id)) continue
          before = Object.hasOwn(existing.custom, column.meta.id) ? existing.custom[column.meta.id] : ''
          initial = Object.hasOwn(baseline.custom, column.meta.id) ? baseline.custom[column.meta.id] : ''
          after = item.custom[column.meta.id]
        }
        if (initial === after) continue
        if (before !== initial && before !== after) throw new Error(`${column.header} changed in Google Sheets; reload before editing`)
        if (before === after) continue
        if (table.rows.get(rowIndex)?.get(column.index)?.userEnteredValue?.formulaValue) throw new Error(`Cannot overwrite a formula in ${column.header} on items row ${rowIndex + 1}`)
        changes.push({ range: `${quoteSheet(table.sheet.properties.title)}!${columnLetter(column.index)}${rowIndex + 1}`, values: [[after ?? '']] })
        if (column.meta.kind === 'core') Object.assign(next, { [column.meta.id]: after })
        else Object.defineProperty(next.custom, column.meta.id, { value: after, enumerable: true, writable: true, configurable: true })
      }
      checkRequiredItem(next, required)
      if (changes.length) await api<unknown>(`${url(id)}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: changes }) }, true)
      state.data.items = state.data.items.map(value => value.id === item.id ? next : value)
      baselines.set(id, structuredClone(state.data))
    },
    async appendItems(id: string, items: Item[], expectedRequirements?: readonly ItemRequirement[]) {
      if (!items.length) return
      const state = await readState(id)
      const required = checkRequirements(state.data, expectedRequirements)
      const ids = new Set(state.data.items.map(item => item.id))
      const codes = new Set(state.data.items.map(item => item.code.trim().toLowerCase()).filter(Boolean))
      for (const item of items) {
        checkItem(item)
        checkCustom(state.data.fields, 'items', item.custom)
        checkRequiredItem(item, required)
        if (ids.has(item.id)) throw new Error(`Duplicate item ID: ${item.id}`)
        ids.add(item.id)
        const code = item.code.trim().toLowerCase()
        if (code && codes.has(code)) throw new Error(`Item code already exists: ${item.code}`)
        if (code) codes.add(code)
      }
      try {
        await append(id, state.tables.items, items.map(item => rowValues(state.tables.items, itemValues(item), item.custom)))
      } catch (error) {
        if (!(error instanceof ApiError) || !error.uncertain) throw error
        if (await verifyAppend(id, items, 'items')) return
        throw new Error('Item import outcome is uncertain or partial. Check the imported codes before retrying; concurrent writes may duplicate them.')
      }
    },
    async saveItemRequirements(id: string, required: ItemRequirement[], expectedRequirements?: readonly ItemRequirement[]) {
      const state = await readState(id)
      checkRequirements(state.data, expectedRequirements)
      validateItemRequirements(required, state.data.fields)
      const desired = new Set(required)
      const changes = state.tables.items.columns.flatMap(column => {
        const identity = itemRequirement(column)
        if (!identity || columnIsRequired(column) === desired.has(identity)) return []
        return [{ column, meta: { ...column.meta, required: desired.has(identity) } }]
      })
      await updateColumnMetadata(id, changes)
    },
    async appendMovements(id: string, movements: Movement[]) {
      if (!movements.length) return
      const state = await readState(id)
      const ids = new Set<string>(), existingIds = new Set(state.data.movements.map(movement => movement.id))
      const itemIds = new Set(state.data.items.map(item => item.id))
      for (const movement of movements) {
        checkMovement(movement, itemIds)
        checkCustom(state.data.fields, 'movements', movement.custom)
        if (ids.has(movement.id)) throw new Error(`Duplicate movement ID: ${movement.id}`)
        ids.add(movement.id)
      }
      if (movements.some(movement => existingIds.has(movement.id))) {
        if (movements.every(movement => state.data.movements.some(existing => existing.id === movement.id && same(existing, movement, state.data.fields, 'movements')))) return
        throw new Error('Some movement IDs already exist or have different values. Inspect the workbook before retrying.')
      }
      try { await append(id, state.tables.movements, movements.map(movement => rowValues(state.tables.movements, movementValues(movement), movement.custom))) } catch (error) {
        if (!(error instanceof ApiError) || !error.uncertain) throw error
        if (await verifyAppend(id, movements, 'movements')) return
        throw new Error('Movement append outcome is uncertain or partial. Check the movement IDs before retrying; concurrent writes may duplicate them.')
      }
    },
    async addField(id: string, field: CustomField) {
      checkField(field)
      const state = await readState(id)
      const table = state.tables[field.target]
      const name = field.name.trim()
      if (state.data.fields.some(existing => existing.id === field.id) || table.columns.some(column => normalized(column.header) === normalized(name)) || CORE[field.target].some(core => normalized(core.id) === normalized(name) || normalized(core.header) === normalized(name))) throw new Error('Duplicate or reserved custom field ID or name')
      const sheetId = table.sheet.properties.sheetId, index = table.sheet.properties.gridProperties!.columnCount!
      const meta: ColumnMeta = { v: 1, kind: 'field', id: field.id, name, type: field.type }
      const requests = [
        { appendDimension: { sheetId, dimension: 'COLUMNS', length: 1 } },
        { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: index }, rows: [{ values: [{ userEnteredValue: { stringValue: name } }] }], fields: 'userEnteredValue' } },
        metadataRequest(sheetId, index, meta),
      ]
      try { await batch(id, requests) } catch (error) {
        if (!(error instanceof ApiError) || !error.uncertain) throw error
        try {
          const verified = await readState(id, false)
          if (verified.data.fields.some(value => value.id === field.id && value.name === name && value.type === field.type && value.target === field.target)) return
        } catch { /* Do not retry an uncertain write. */ }
        throw new Error('Custom field creation outcome is uncertain. Inspect the workbook before trying again.')
      }
    },
    async updateField(id: string, field: CustomField) {
      checkField(field)
      const state = await readState(id)
      const current = state.data.fields.find(existing => existing.id === field.id)
      if (!current) throw new Error('Custom field not found; reload the ledger before editing it.')
      if (current.target !== field.target || current.name !== field.name.trim()) throw new Error('Reload the ledger before editing a custom field; only its type can change.')
      if (current.type === field.type) return
      const table = state.tables[field.target]
      const column = table.columns.find(entry => entry.meta.kind === 'field' && entry.meta.id === field.id)
      if (!column) throw new Error('Custom field column not found; reload the ledger before editing it.')
      const rows: number[] = []
      for (const [index, row] of [...table.rows].sort((a, b) => a[0] - b[0])) {
        if (index === 0) continue
        if (!isValidFieldValue(field.type, text(row.get(column.index)))) rows.push(index + 1)
      }
      if (rows.length) throw new FieldValueError(field.type, rows)
      await updateColumnMetadata(id, [{ column, meta: { ...column.meta, type: field.type } }])
      const baseline = baselines.get(id)?.fields.find(value => value.id === field.id)
      if (baseline) baseline.type = field.type
    },
    async repairMissingColumn(id: string, target: FieldTarget, coreId: string) {
      const core = CORE[target].find(column => column.id === coreId)
      if (!core || !REPAIRABLE_CORE[target].includes(coreId)) throw new Error('This column cannot be added automatically.')
      const info = await api<{ sheets?: Array<{ properties: { sheetId: number; title: string; gridProperties?: { columnCount?: number } } }> }>(
        `${url(id)}?fields=${encodeURIComponent('sheets(properties(sheetId,title,gridProperties(columnCount)))')}`,
      )
      const matches = (info.sheets || []).filter(sheet => sheet.properties.title.toLowerCase() === target)
      if (matches.length !== 1) throw new Error(`Expected one ${target} sheet`)
      const sheet = matches[0]
      const width = sheet.properties.gridProperties?.columnCount
      if (!width || !Number.isInteger(width)) throw new Error(`Invalid ${target} sheet dimensions`)
      const header = await api<{ values?: string[][] }>(`${url(id)}/values/${encodeURIComponent(`${quoteSheet(sheet.properties.title)}!1:1`)}?majorDimension=ROWS`)
      const names = (header.values?.[0] || []).map(value => normalized(String(value)))
      if (names.includes(normalized(core.id)) || names.includes(normalized(core.header))) throw new Error(`A ${core.header} column already exists; reload the ledger.`)
      const requests = [
        { appendDimension: { sheetId: sheet.properties.sheetId, dimension: 'COLUMNS', length: 1 } },
        { updateCells: { start: { sheetId: sheet.properties.sheetId, rowIndex: 0, columnIndex: width }, rows: [{ values: [{ userEnteredValue: { stringValue: core.header } }] }], fields: 'userEnteredValue' } },
        metadataRequest(sheet.properties.sheetId, width, { v: 1, kind: 'core', id: core.id }),
      ]
      try { await batch(id, requests) } catch (error) {
        if (!(error instanceof ApiError) || !error.uncertain) throw error
        try {
          const verified = await readState(id, false)
          if (verified.tables[target].core.get(core.id)?.index === width) return
        } catch { /* Do not retry an uncertain write. */ }
        throw new Error('Column repair outcome is uncertain. Reload the ledger and check it before trying again.')
      }
    },
  }
}
