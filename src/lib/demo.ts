import { getRunningBalances } from './inventory'
import { FieldValueError, isValidFieldValue } from './fields'
import type { CustomField, InventoryRepository, Item, Movement, WarehouseData, WorkbookRef } from './types'

const copy = <T>(value: T): T => structuredClone(value)

export function createDemoRepository(): InventoryRepository {
  const workbooks = new Map<string, { ref: WorkbookRef; data: WarehouseData }>()
  const ref = { id: 'demo', name: 'Demo / تجريبي' }
  workbooks.set(ref.id, {
    ref,
    data: {
      fields: [{ id: 'demo-supplier', name: 'Supplier / المورد', type: 'text', target: 'items' }],
      items: [
        { id: 'demo-rice', code: 'RICE-01', name: 'Rice / أرز', unit: 'kg', openingBalance: 50, category: 'Food', minimumStock: 15, location: 'A-01', notes: '', custom: { 'demo-supplier': 'Local market' } },
        { id: 'demo-oil', code: 'OIL-01', name: 'Olive oil / زيت زيتون', unit: 'bottle', openingBalance: 24, category: 'Food', minimumStock: 6, location: 'A-02', notes: '', custom: { 'demo-supplier': 'Olive farm' } },
        { id: 'demo-box', code: 'BOX-01', name: 'Boxes / صناديق', unit: 'piece', openingBalance: 100, category: 'Packaging', minimumStock: 20, location: 'B-01', notes: '', custom: {} },
      ],
      movements: [
        { id: 'demo-m1', itemId: 'demo-rice', date: '2025-01-10', kind: 'in', quantity: 25, party: 'Local market', document: 'INV-101', notes: '', custom: {} },
        { id: 'demo-m2', itemId: 'demo-rice', date: '2025-01-12', kind: 'out', quantity: 10, party: 'Kitchen', document: 'REQ-12', notes: '', custom: {} },
        { id: 'demo-m3', itemId: 'demo-oil', date: '2025-01-13', kind: 'adjustment', quantity: -2, party: '', document: 'COUNT-01', notes: 'Stock count', custom: {} },
      ],
    },
  })
  const get = (id: string) => {
    const workbook = workbooks.get(id)
    if (!workbook) throw new Error('Demo workbook not found')
    return workbook
  }
  const checkCustom = (data: WarehouseData, target: CustomField['target'], custom: Record<string, string>) => {
    for (const [id, value] of Object.entries(custom)) {
      if (!data.fields.some(field => field.id === id && field.target === target) || typeof value !== 'string') {
        throw new Error(`Unknown or invalid custom field: ${id}`)
      }
    }
  }
  return {
    async listWorkbooks() { return [...workbooks.values()].map(({ ref }) => copy(ref)) },
    async createWorkbook(name: string) {
      if (!name.trim()) throw new Error('Workbook name is required')
      const ref = { id: crypto.randomUUID(), name: `${name.trim()} (Demo / تجريبي)` }
      workbooks.set(ref.id, { ref, data: { items: [], movements: [], fields: [] } })
      return copy(ref)
    },
    async loadWorkbook(id: string) { return copy(get(id).data) },
    async saveItem(id: string, item: Item) {
      const { data } = get(id)
      if (!item.id || !item.name || !Number.isFinite(item.openingBalance) || (item.minimumStock !== null && !Number.isFinite(item.minimumStock))) throw new Error('Invalid item')
      checkCustom(data, 'items', item.custom)
      const index = data.items.findIndex(existing => existing.id === item.id)
      if (index < 0) data.items.push(copy(item))
      else {
        if (data.items[index].openingBalance !== item.openingBalance) throw new Error('Opening balance cannot be edited after creation; record a stock-count adjustment instead.')
        data.items[index] = copy(item)
      }
    },
    async appendItems(id: string, items: Item[]) {
      const { data } = get(id)
      const ids = new Set(data.items.map(item => item.id))
      const codes = new Set(data.items.map(item => item.code.trim().toLowerCase()))
      for (const item of items) {
        if (!item.id || !item.name || !Number.isFinite(item.openingBalance) || (item.minimumStock !== null && !Number.isFinite(item.minimumStock))) throw new Error('Invalid item')
        checkCustom(data, 'items', item.custom)
        if (ids.has(item.id)) throw new Error(`Duplicate item ID: ${item.id}`)
        const code = item.code.trim().toLowerCase()
        if (!code || codes.has(code)) throw new Error(`Item code already exists: ${item.code}`)
        ids.add(item.id)
        codes.add(code)
      }
      data.items.push(...copy(items))
    },
    async appendMovements(id: string, movements: Movement[]) {
      const { data } = get(id)
      const ids = new Set(data.movements.map(movement => movement.id))
      for (const movement of movements) {
        if (!movement.id || ids.has(movement.id)) throw new Error(`Duplicate or missing movement ID: ${movement.id}`)
        const item = data.items.find(item => item.id === movement.itemId)
        if (!item) throw new Error(`Unknown item: ${movement.itemId}`)
        getRunningBalances(item, [movement])
        checkCustom(data, 'movements', movement.custom)
        ids.add(movement.id)
      }
      data.movements.push(...copy(movements))
    },
    async addField(id: string, field: CustomField) {
      const { data } = get(id)
      if (!field.id || !field.name.trim() || !['items', 'movements'].includes(field.target) || !['text', 'number', 'date'].includes(field.type)) throw new Error('Invalid custom field')
      if (data.fields.some(existing => existing.id === field.id || (existing.target === field.target && existing.name.toLowerCase() === field.name.trim().toLowerCase()))) throw new Error('Duplicate custom field')
      data.fields.push(copy({ ...field, name: field.name.trim() }))
    },
    async updateField(id: string, field: CustomField) {
      const { data } = get(id)
      const current = data.fields.find(existing => existing.id === field.id)
      if (!current) throw new Error('Custom field not found; reload the ledger before editing it.')
      if (current.target !== field.target || current.name !== field.name.trim()) throw new Error('Reload the ledger before editing a custom field; only its type can change.')
      if (current.type === field.type) return
      const records: Array<Item | Movement> = current.target === 'items' ? data.items : data.movements
      const rows = records.flatMap((record, index) => !record.custom[field.id] || isValidFieldValue(field.type, record.custom[field.id]) ? [] : [index + 1])
      if (rows.length) throw new FieldValueError(field.type, rows)
      current.type = field.type
    },
  }
}
