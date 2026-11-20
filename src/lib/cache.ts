import { createStore, delMany, entries, set } from 'idb-keyval'
import type { WarehouseData, WorkbookRef } from './types'

export interface CachedSnapshot {
  accountId: string
  email: string
  workbook: WorkbookRef
  data: WarehouseData
  savedAt: string
}

const store = createStore('rufoof-snapshots', 'snapshots')
const keyFor = (accountId: string, workbookId: string) => JSON.stringify([accountId, workbookId])

export async function saveSnapshot(snapshot: CachedSnapshot): Promise<void> {
  if (!snapshot.accountId || !snapshot.workbook.id) throw new Error('A snapshot requires an account and workbook ID')
  // Copy only contract fields: a caller cannot accidentally persist its GoogleSession/token.
  const safe: CachedSnapshot = {
    accountId: snapshot.accountId,
    email: snapshot.email,
    workbook: { id: snapshot.workbook.id, name: snapshot.workbook.name },
    savedAt: snapshot.savedAt,
    data: {
      fields: snapshot.data.fields.map(({ id, name, type, target }) => ({ id, name, type, target })),
      items: snapshot.data.items.map(({ id, code, name, unit, openingBalance, category, minimumStock, location, notes, custom }) =>
        ({ id, code, name, unit, openingBalance, category, minimumStock, location, notes, custom: { ...custom } })),
      movements: snapshot.data.movements.map(({ id, itemId, date, kind, quantity, party, document, notes, custom }) =>
        ({ id, itemId, date, kind, quantity, party, document, notes, custom: { ...custom } })),
    },
  }
  await set(keyFor(safe.accountId, safe.workbook.id), safe, store)
}

export async function listSnapshots(): Promise<CachedSnapshot[]> {
  const all = await entries<string, CachedSnapshot>(store)
  return all.map(([, snapshot]) => snapshot).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function clearSnapshots(accountId: string): Promise<void> {
  const all = await entries<string, CachedSnapshot>(store)
  const keys = all.filter(([, snapshot]) => snapshot.accountId === accountId).map(([key]) => key)
  if (keys.length) await delMany(keys, store)
}
