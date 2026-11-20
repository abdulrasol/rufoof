import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedSnapshot } from './cache'

const memory = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  set: async (key: string, value: unknown) => { memory.set(key, structuredClone(value)) },
  entries: async () => [...memory.entries()],
  delMany: async (keys: string[]) => { keys.forEach(key => memory.delete(key)) },
}))
import { clearSnapshots, listSnapshots, saveSnapshot } from './cache'

const snapshot = (accountId: string, id: string): CachedSnapshot => ({ accountId, email: `${accountId}@example.com`, workbook: { id, name: 'Warehouse' }, data: { items: [], movements: [], fields: [] }, savedAt: '2025-01-01T00:00:00Z' })
beforeEach(() => memory.clear())
afterEach(() => memory.clear())

describe('snapshot storage', () => {
  it('preserves required field settings in offline copies', async () => {
    const original = snapshot('a', '1')
    original.data.requiredItemFields = ['name', 'unit', 'field:batch']
    await saveSnapshot(original)
    original.data.requiredItemFields.push('code')
    expect((await listSnapshots())[0].data.requiredItemFields).toEqual(['name', 'unit', 'field:batch'])
  })

  it('separates account/workbook choices and omits extra session fields', async () => {
    await saveSnapshot({ ...snapshot('a', '1'), accessToken: 'never-store' } as CachedSnapshot)
    await saveSnapshot(snapshot('a', '2'))
    await saveSnapshot(snapshot('b', '1'))
    expect(await listSnapshots()).toHaveLength(3)
    expect(JSON.stringify([...memory.values()])).not.toContain('never-store')
    await clearSnapshots('a')
    expect(await listSnapshots()).toEqual([snapshot('b', '1')])
  })
})
