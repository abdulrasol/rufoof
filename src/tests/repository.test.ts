import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoRepository } from '../lib/demo'
import { authorizeGoogle, googleRepository } from '../lib/google'
import { getBalance } from '../lib/inventory'
import type { CustomField, GoogleSession, Item, Movement } from '../lib/types'

const item: Item = {
  id: 'item-1', code: 'A-001', name: 'Paper', unit: 'box', openingBalance: 12,
  category: 'Office', minimumStock: 3, location: '', notes: '', custom: {},
}
const movement: Movement = {
  id: 'movement-1', itemId: item.id, date: '2026-11-20', kind: 'out', quantity: 2,
  party: '', document: '', notes: '', custom: {},
}
const field: CustomField = { id: 'field-1', name: 'Color', type: 'text', target: 'items' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('demo repository', () => {
  it('creates a workspace and stores items, movements and custom fields for that session', async () => {
    const repo = createDemoRepository()
    const workbook = await repo.createWorkbook('Test warehouse')
    await repo.saveItem(workbook.id, item)
    await repo.appendMovements(workbook.id, [movement])
    await repo.addField(workbook.id, field)

    const data = await repo.loadWorkbook(workbook.id)
    expect(data.items).toContainEqual(expect.objectContaining({ id: item.id, code: item.code }))
    expect(data.movements).toContainEqual(expect.objectContaining({ id: movement.id, quantity: 2 }))
    expect(data.fields).toContainEqual(expect.objectContaining({ id: field.id, name: field.name }))
  })

  it('prevents stock changes through opening-balance edits', async () => {
    const repo = createDemoRepository()
    const workbook = await repo.createWorkbook('Audit test')
    await repo.saveItem(workbook.id, item)
    await expect(repo.saveItem(workbook.id, { ...item, openingBalance: 99 })).rejects.toThrow(/opening balance/i)
    const data = await repo.loadWorkbook(workbook.id)
    expect(getBalance(data.items[0], data.movements)).toBe(12)
  })

  it('records incoming, outgoing and stock-count adjustments as movements', async () => {
    const repo = createDemoRepository()
    const workbook = await repo.createWorkbook('Count test')
    await repo.saveItem(workbook.id, item)
    await repo.appendMovements(workbook.id, [
      { ...movement, id: 'incoming', kind: 'in', quantity: 5 },
      { ...movement, id: 'outgoing', kind: 'out', quantity: 2 },
    ])
    let data = await repo.loadWorkbook(workbook.id)
    expect(getBalance(data.items[0], data.movements)).toBe(15)
    await repo.appendMovements(workbook.id, [{ ...movement, id: 'count', kind: 'adjustment', quantity: 17 - 15 }])
    data = await repo.loadWorkbook(workbook.id)
    expect(data.movements).toHaveLength(3)
    expect(getBalance(data.items[0], data.movements)).toBe(17)
  })

  it('does not persist a demo workspace into another session', async () => {
    const first = createDemoRepository()
    const workbook = await first.createWorkbook('Temporary demo warehouse')
    const fresh = createDemoRepository()
    expect(await fresh.listWorkbooks()).not.toContainEqual(expect.objectContaining({ id: workbook.id }))
  })
})

describe('Google repository', () => {
  it('rejects sign-in when the Google client ID is not configured', async () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: true } })
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    await expect(authorizeGoogle()).rejects.toThrow(/VITE_GOOGLE_CLIENT_ID/)
  })

  it('requests the limited Drive scope and identifies the signed-in account', async () => {
    const initTokenClient = vi.fn((options: { client_id: string; scope: string; callback: (value: { access_token: string; expires_in: number }) => void }) => ({
      requestAccessToken: () => options.callback({ access_token: 'test-token', expires_in: 3600 }),
    }))
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient } } } })
    vi.stubGlobal('navigator', { userActivation: { isActive: true } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sub: 'account-1', email: 'example@example.test', name: 'Example',
    }), { status: 200 })))
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client')

    const session = await authorizeGoogle()
    expect(session).toMatchObject({ accountId: 'account-1', email: 'example@example.test', accessToken: 'test-token' })
    const options = initTokenClient.mock.calls[0][0]
    expect(options.client_id).toBe('test-client')
    expect(options.scope.split(' ').sort()).toEqual(['email', 'https://www.googleapis.com/auth/drive.file', 'openid', 'profile'].sort())
  })

  it('creates and initializes the two warehouse sheets', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ spreadsheetId: 'new-sheet', properties: { title: 'Warehouse' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ replies: [] }), { status: 200 }))
    vi.stubGlobal('fetch', request)
    const session: GoogleSession = {
      accessToken: 'test-token', expiresAt: Date.now() + 60_000,
      accountId: 'account-1', email: 'example@example.test', name: 'Example',
    }
    const result = await googleRepository(session).createWorkbook('Warehouse')
    expect(result).toEqual({ id: 'new-sheet', name: 'Warehouse' })
    expect(request).toHaveBeenCalledTimes(2)
    const [createUrl, createInit] = request.mock.calls[0] as [string, RequestInit]
    const created = JSON.parse(String(createInit.body))
    expect(createUrl).toBe('https://sheets.googleapis.com/v4/spreadsheets')
    expect(created.sheets.map((sheet: { properties: { title: string } }) => sheet.properties.title)).toEqual(['items', 'movements'])
    const [, initializeInit] = request.mock.calls[1] as [string, RequestInit]
    const initialization = JSON.parse(String(initializeInit.body))
    expect(initialization.requests.filter((entry: { createDeveloperMetadata?: unknown }) => entry.createDeveloperMetadata).length).toBeGreaterThan(0)
  })

  it('sends the in-memory bearer token when listing available spreadsheet files', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      files: [{ id: 'sheet-1', name: 'Warehouse' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', request)
    const session: GoogleSession = {
      accessToken: 'test-token', expiresAt: Date.now() + 60_000,
      accountId: 'account-1', email: 'example@example.test', name: 'Example',
    }
    const result = await googleRepository(session).listWorkbooks()
    expect(result).toContainEqual(expect.objectContaining({ id: 'sheet-1', name: 'Warehouse' }))
    expect(request).toHaveBeenCalled()
    const [url, init] = request.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).hostname).toBe('www.googleapis.com')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-token')
  })

  it('surfaces an expired session without exposing the bearer token', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 401, message: 'Invalid Credentials' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', request)
    const session: GoogleSession = {
      accessToken: 'test-token', expiresAt: Date.now() + 60_000,
      accountId: 'account-1', email: 'example@example.test', name: 'Example',
    }
    let failure: unknown
    try {
      await googleRepository(session).listWorkbooks()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeDefined()
    expect(String(failure)).not.toContain('test-token')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
