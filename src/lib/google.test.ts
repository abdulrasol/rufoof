import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleRepository, WorkbookDataError } from './google'
import { FieldValueError } from './fields'
import type { GoogleSession, Movement } from './types'

const session: GoogleSession = { accessToken: 'test-token', expiresAt: Date.now() + 3600000, accountId: 'account', email: 'test@example.com', name: 'Test' }
const itemColumns = [['Name', 'name'], ['ID', 'id'], ['Code', 'code'], ['Unit', 'unit'], ['Opening Balance', 'openingBalance'], ['Category', 'category'], ['Minimum Stock', 'minimumStock'], ['Location', 'location'], ['Notes', 'notes']] as const
const movementColumns = [['ID', 'id'], ['Item ID', 'itemId'], ['Date', 'date'], ['Kind', 'kind'], ['Quantity', 'quantity'], ['Party', 'party'], ['Document', 'document'], ['Notes', 'notes']] as const
const makeCell = (value: string | number) => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value }, effectiveValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function fixture() {
  const formula = { userEnteredValue: { formulaValue: '=UPPER("warehouse")' }, effectiveValue: { stringValue: 'WAREHOUSE' } }
  const items = { properties: { sheetId: 1, title: 'items', gridProperties: { columnCount: 26 } }, data: [{ rowData: [
    { values: [...itemColumns.map(([header]) => makeCell(header)), makeCell('Formula'), makeCell('Manual')] },
    { values: [makeCell('Rice'), makeCell('item-1'), makeCell('R-1'), makeCell('kg'), makeCell(10), makeCell('Food'), makeCell(2), makeCell('A'), makeCell(''), formula, makeCell('keep')] },
  ] }] }
  const movements = { properties: { sheetId: 2, title: 'movements', gridProperties: { columnCount: 26 } }, data: [{ rowData: [
    { values: movementColumns.map(([header]) => makeCell(header)) },
    { values: ['m-1', 'item-1', '2025-01-01', 'in', 2, '', '', ''].map(makeCell) },
  ] }] }
  const metadata = [
    ...itemColumns.map(([, id], index) => ({ metadataKey: 'rufoof.column', metadataValue: JSON.stringify({ v: 1, kind: 'core', id }), location: { dimensionRange: { sheetId: 1, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 } } })),
    ...movementColumns.map(([, id], index) => ({ metadataKey: 'rufoof.column', metadataValue: JSON.stringify({ v: 1, kind: 'core', id }), location: { dimensionRange: { sheetId: 2, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 } } })),
    { metadataKey: 'rufoof.column', metadataValue: JSON.stringify({ v: 1, kind: 'field', id: 'f-formula', name: 'Formula', type: 'text' }), location: { dimensionRange: { sheetId: 1, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 } } },
    { metadataKey: 'rufoof.column', metadataValue: JSON.stringify({ v: 1, kind: 'field', id: 'f-manual', name: 'Manual', type: 'number' }), location: { dimensionRange: { sheetId: 1, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 } } },
  ]
  const writes: Array<{ url: string; body: any }> = []
  let uncertainAppend: 'applied' | 'lost' | false = false
  let uncertainMetadata = false
  let forbiddenWrites = false
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url.includes('/developerMetadata:search')) return json({ matchedDeveloperMetadata: metadata.map(developerMetadata => ({ developerMetadata })) })
    if (url.includes('?includeGridData=true')) return json({ sheets: [items, movements] })
    if (init?.method !== 'POST' && url.includes('/values/')) {
      const sheet = decodeURIComponent(url).includes("'items'") ? items : movements
      return json({ values: [(sheet.data[0].rowData[0].values || []).map(cell => { const value = cell.userEnteredValue as { stringValue?: string; numberValue?: number } | undefined; return String(value?.stringValue ?? value?.numberValue ?? '') })] })
    }
    if (url.includes('?fields=')) return json({ sheets: [{ properties: items.properties }, { properties: movements.properties }] })
    if (init?.method === 'POST') {
      writes.push({ url, body })
      if (forbiddenWrites) return json({ error: { message: 'denied' } }, 401)
      if (url.endsWith(':batchUpdate') && body.requests) {
        if (uncertainMetadata) throw new TypeError('metadata write outcome unknown')
        for (const request of body.requests) if (request.createDeveloperMetadata) metadata.push(request.createDeveloperMetadata.developerMetadata)
        return json({})
      }
      if (url.includes(':append') && uncertainAppend) {
        if (uncertainAppend === 'applied') movements.data[0].rowData.push({ values: body.values[0].map(makeCell) })
        throw new TypeError('connection lost with an uncertain write outcome')
      }
      return json({})
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', mock)
  return { items, movements, metadata, writes, mock, makeUncertain: (applied = true) => { uncertainAppend = applied ? 'applied' : 'lost' }, makeMetadataUncertain: () => { uncertainMetadata = true }, deny: () => { forbiddenWrites = true } }
}
const newMovement: Movement = { id: 'm-new', itemId: 'item-1', date: '2025-02-01', kind: 'out', quantity: 3, party: '', document: '', notes: '', custom: {} }
afterEach(() => vi.unstubAllGlobals())

describe('Google Sheets repository with mocked REST responses', () => {
  it('maps moved core columns by metadata and preserves custom field types', async () => {
    fixture()
    const data = await googleRepository(session).loadWorkbook('book')
    expect(data.items[0]).toMatchObject({ id: 'item-1', name: 'Rice', openingBalance: 10, custom: { 'f-formula': 'WAREHOUSE', 'f-manual': 'keep' } })
    expect(data.fields).toContainEqual({ id: 'f-manual', name: 'Manual', type: 'number', target: 'items' })
    expect(data.movements[0].itemId).toBe('item-1')
  })

  it('persists a stable metadata ID when discovering a manually added column', async () => {
    const sheet = fixture()
    sheet.metadata.splice(sheet.metadata.findIndex(value => JSON.parse(value.metadataValue).id === 'f-manual'), 1)
    const repository = googleRepository(session)
    const [first, second] = await Promise.all([repository.loadWorkbook('book'), repository.loadWorkbook('book')])
    const manual = first.fields.find(field => field.name === 'Manual')!
    expect(manual.type).toBe('text')
    expect(second.fields.find(field => field.name === 'Manual')?.id).toBe(manual.id)
    expect(first.items[0].custom[manual.id]).toBe('keep')
    expect(sheet.writes).toHaveLength(1)
  })

  it('does not repeat an unverified metadata discovery on a later load', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.metadata.splice(sheet.metadata.findIndex(value => JSON.parse(value.metadataValue).id === 'f-manual'), 1)
    sheet.makeMetadataUncertain()
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await repository.loadWorkbook('book').catch(error => error)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(WorkbookDataError)
      expect(error.message).toMatch(/uncertain/i)
    }
    expect(sheet.writes).toHaveLength(1)
  })

  it.each([
    ['missing sheet', (sheet: ReturnType<typeof fixture>) => { sheet.items.properties.title = 'other' }],
    ['malformed sheet', (sheet: ReturnType<typeof fixture>) => { sheet.items.properties.title = null as unknown as string }],
    ['missing core column', (sheet: ReturnType<typeof fixture>) => {
      sheet.metadata.splice(2, 1)
      sheet.items.data[0].rowData[0].values[2] = makeCell('')
    }],
    ['ambiguous core column', (sheet: ReturnType<typeof fixture>) => {
      sheet.items.data[0].rowData[0].values[1] = makeCell('Product key')
      sheet.items.data[0].rowData[0].values.push(makeCell('ID'))
    }],
    ['duplicate metadata', (sheet: ReturnType<typeof fixture>) => { sheet.metadata.push(sheet.metadata[0]) }],
    ['duplicate header', (sheet: ReturnType<typeof fixture>) => { sheet.items.data[0].rowData[0].values[2] = makeCell('Name') }],
    ['invalid quantity', (sheet: ReturnType<typeof fixture>) => { sheet.movements.data[0].rowData[1].values[4] = makeCell('1,000') }],
    ['unknown item reference', (sheet: ReturnType<typeof fixture>) => { sheet.movements.data[0].rowData[1].values[1] = makeCell('unknown') }],
    ['invalid movement kind', (sheet: ReturnType<typeof fixture>) => { sheet.movements.data[0].rowData[1].values[3] = makeCell('invalid') }],
  ])('classifies %s as workbook data errors', async (_description, corrupt) => {
    const sheet = fixture()
    corrupt(sheet)
    const error = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(error).toBeInstanceOf(WorkbookDataError)
    expect(error.name).toBe('WorkbookDataError')
    expect(sheet.writes).toHaveLength(0)
  })

  it('does not include workbook contents in the new error message', async () => {
    const sheet = fixture()
    const sensitiveValue = 'private-item-reference'
    sheet.movements.data[0].rowData[1].values[1] = makeCell(sensitiveValue)
    const error = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(error).toBeInstanceOf(WorkbookDataError)
    expect(error.message).not.toContain(sensitiveValue)
    expect(error.message).not.toContain(session.accessToken)
  })

  it('does not include formula error response details in the new message', async () => {
    const sheet = fixture()
    const sensitiveValue = 'private-formula-response'
    Object.assign(sheet.items.data[0].rowData[1].values[9], { effectiveValue: { errorValue: { message: sensitiveValue } } })
    const error = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(error).toBeInstanceOf(WorkbookDataError)
    expect(error.message).not.toContain(sensitiveValue)
  })

  it('leaves validation errors from write operations unchanged', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.movements.data[0].rowData[1].values[4] = makeCell('invalid')
    const error = await repository.appendMovements('book', [newMovement]).catch(error => error)
    expect(error).not.toBeInstanceOf(WorkbookDataError)
    expect(error.message).toMatch(/invalid quantity/i)
    expect(sheet.writes).toHaveLength(0)
  })

  it('classifies invalid rows after concurrent metadata discovery without retrying the write', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.metadata.splice(sheet.metadata.findIndex(value => JSON.parse(value.metadataValue).id === 'f-manual'), 1)
    sheet.movements.data[0].rowData[1].values[4] = makeCell('invalid')
    const results = await Promise.allSettled([repository.loadWorkbook('book'), repository.loadWorkbook('book')])
    for (const result of results) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(WorkbookDataError)
    }
    expect(sheet.writes).toHaveLength(1)
  })

  it('preserves API errors when loading or discovering metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { message: 'private response' } }, 401))
    vi.stubGlobal('fetch', fetchMock)
    const unauthorized = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(unauthorized).not.toBeInstanceOf(WorkbookDataError)
    expect(unauthorized.constructor.name).toBe('ApiError')
    expect(unauthorized).toMatchObject({ status: 401, message: expect.stringMatching(/sign in again/i) })

    const sheet = fixture()
    sheet.metadata.splice(sheet.metadata.findIndex(value => JSON.parse(value.metadataValue).id === 'f-manual'), 1)
    sheet.deny()
    const discoveryError = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(discoveryError).not.toBeInstanceOf(WorkbookDataError)
    expect(discoveryError.constructor.name).toBe('ApiError')
    expect(discoveryError).toMatchObject({ status: 401, message: expect.stringMatching(/sign in again/i) })
    expect(sheet.writes).toHaveLength(1)
  })

  it('preserves network read errors instead of treating them as workbook data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network detail')))
    const error = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(error).not.toBeInstanceOf(WorkbookDataError)
    expect(error.constructor.name).toBe('ApiError')
    expect(error).toMatchObject({ uncertain: false, message: 'Network error while reading Google data.' })
  })

  it('writes only locally edited cells, preserving remote edits and formulas', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    const data = await repository.loadWorkbook('book')
    sheet.items.data[0].rowData[1].values[10] = makeCell('remote change')
    await repository.saveItem('book', { ...data.items[0], name: 'Brown rice' })
    expect(sheet.writes).toHaveLength(1)
    expect(sheet.writes[0].body).toEqual({ valueInputOption: 'RAW', data: [{ range: "'items'!A2", values: [['Brown rice']] }] })
    expect(sheet.items.data[0].rowData[1].values[9]).toHaveProperty('userEnteredValue.formulaValue')
  })

  it('rejects an opening-balance edit that would bypass the movement ledger', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    const data = await repository.loadWorkbook('book')
    await expect(repository.saveItem('book', { ...data.items[0], openingBalance: 99 })).rejects.toThrow(/opening balance/i)
    expect(sheet.writes).toHaveLength(0)
  })

  it('rejects edits to formulas and conflicting simultaneous changes', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    const data = await repository.loadWorkbook('book')
    await expect(repository.saveItem('book', { ...data.items[0], custom: { ...data.items[0].custom, 'f-formula': 'changed' } })).rejects.toThrow(/formula/i)
    sheet.items.data[0].rowData[1].values[0] = makeCell('Other name')
    await expect(repository.saveItem('book', { ...data.items[0], name: 'New name' })).rejects.toThrow(/changed in Google Sheets/)
    expect(sheet.writes).toHaveLength(0)
  })

  it('checks UUIDs after an uncertain append without retrying', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.makeUncertain()
    await expect(repository.appendMovements('book', [newMovement])).resolves.toBeUndefined()
    expect(sheet.writes.filter(write => write.url.includes(':append'))).toHaveLength(1)
    await expect(repository.appendMovements('book', [newMovement])).resolves.toBeUndefined()
    expect(sheet.writes.filter(write => write.url.includes(':append'))).toHaveLength(1)
  })

  it('does not retry or report success when an uncertain append cannot be verified', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.makeUncertain(false)
    await expect(repository.appendMovements('book', [newMovement])).rejects.toThrow(/uncertain/i)
    expect(sheet.writes.filter(write => write.url.includes(':append'))).toHaveLength(1)
  })

  it('creates a typed field in a new column without replacing existing columns', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    await repository.addField('book', { id: 'expiry', name: 'Expiry', type: 'date', target: 'items' })
    const requests = sheet.writes[0].body.requests
    expect(requests[0]).toEqual({ appendDimension: { sheetId: 1, dimension: 'COLUMNS', length: 1 } })
    expect(requests[1].updateCells.start.columnIndex).toBe(26)
    expect(JSON.parse(requests[2].createDeveloperMetadata.developerMetadata.metadataValue)).toMatchObject({ id: 'expiry', name: 'Expiry', type: 'date' })
  })

  it('surfaces 401 as a reauthorization error', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.deny()
    await expect(repository.appendMovements('book', [newMovement])).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/sign in again/i) })
  })

  it('updates only field metadata after checking existing values match the new type', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.items.data[0].rowData[1].values[9] = makeCell('42')
    await repository.updateField('book', { id: 'f-formula', name: 'Formula', type: 'number', target: 'items' })
    expect(sheet.writes).toHaveLength(1)
    const request = sheet.writes[0].body.requests[0].updateDeveloperMetadata
    expect(JSON.parse(request.developerMetadata.metadataValue)).toEqual({ v: 1, kind: 'field', id: 'f-formula', name: 'Formula', type: 'number' })
    expect(request.fields).toBe('metadataValue')
    expect(request.dataFilters[0].developerMetadataLookup.location.dimensionRange).toMatchObject({ sheetId: 1, startIndex: 9, endIndex: 10 })
    expect(sheet.items.data[0].rowData[1].values[9]).toEqual(makeCell('42'))
  })

  it('refuses a field type change when existing values do not match', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    const error = await repository.updateField('book', { id: 'f-formula', name: 'Formula', type: 'number', target: 'items' }).catch(value => value)
    expect(error).toBeInstanceOf(FieldValueError)
    expect(error).toMatchObject({ type: 'number', rows: [2] })
    expect(sheet.writes).toHaveLength(0)
  })

  it('does not rename or move a field through a type change', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    await expect(repository.updateField('book', { id: 'f-manual', name: 'Renamed', type: 'text', target: 'items' })).rejects.toThrow(/reload/i)
    await expect(repository.updateField('book', { id: 'missing', name: 'Manual', type: 'text', target: 'items' })).rejects.toThrow(/not found/i)
    expect(sheet.writes).toHaveLength(0)
  })

  it('does not repeat an uncertain field update', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.makeMetadataUncertain()
    await expect(repository.updateField('book', { id: 'f-manual', name: 'Manual', type: 'text', target: 'items' })).rejects.toThrow(/uncertain/i)
    expect(sheet.writes.filter(write => write.url.endsWith(':batchUpdate'))).toHaveLength(1)
  })

  it('appends a missing optional core column with its metadata', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    sheet.metadata.splice(8, 1)
    sheet.items.data[0].rowData[0].values[8] = makeCell('')
    await repository.repairMissingColumn!('book', 'items', 'notes')
    const requests = sheet.writes[0].body.requests
    expect(requests[0]).toEqual({ appendDimension: { sheetId: 1, dimension: 'COLUMNS', length: 1 } })
    expect(requests[1].updateCells.start.columnIndex).toBe(26)
    expect(JSON.parse(requests[2].createDeveloperMetadata.developerMetadata.metadataValue)).toEqual({ v: 1, kind: 'core', id: 'notes' })
  })

  it('refuses to add required or already-present columns automatically', async () => {
    const sheet = fixture(), repository = googleRepository(session)
    await expect(repository.repairMissingColumn!('book', 'items', 'id')).rejects.toThrow(/cannot be added/i)
    await expect(repository.repairMissingColumn!('book', 'items', 'notes')).rejects.toThrow(/already exists/i)
    expect(sheet.writes).toHaveLength(0)
  })

  it('reports the sheet, column and row for a schema problem', async () => {
    const sheet = fixture()
    sheet.metadata.splice(2, 1)
    sheet.items.data[0].rowData[0].values[2] = makeCell('')
    const missing = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(missing).toBeInstanceOf(WorkbookDataError)
    expect(missing.issues[0]).toEqual({ code: 'missingCore', target: 'items', coreId: 'code', header: 'Code' })

    const rows = fixture()
    rows.movements.data[0].rowData[1].values[4] = makeCell('1,000')
    const invalid = await googleRepository(session).loadWorkbook('book').catch(error => error)
    expect(invalid).toBeInstanceOf(WorkbookDataError)
    expect(invalid.issues[0]).toEqual({ code: 'invalidRow', target: 'movements', row: 2 })
  })
})
