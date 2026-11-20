import { describe, expect, it } from 'vitest'
import { createDemoRepository } from './demo'
import { FieldValueError } from './fields'

describe('demo repository', () => {
  it('isolates in-memory data, supports fields and protects its internal state', async () => {
    const demo = createDemoRepository()
    const [workbook] = await demo.listWorkbooks()
    const data = await demo.loadWorkbook(workbook.id)
    const original = data.items[0].name
    data.items[0].name = 'unsaved'
    expect((await demo.loadWorkbook(workbook.id)).items[0].name).toBe(original)
    await demo.addField(workbook.id, { id: 'expiry', name: 'Expiry', type: 'date', target: 'items' })
    await demo.saveItem(workbook.id, { ...data.items[0], custom: { ...data.items[0].custom, expiry: '2026-01-01' } })
    expect((await demo.loadWorkbook(workbook.id)).items[0].custom.expiry).toBe('2026-01-01')
    expect((await createDemoRepository().loadWorkbook('demo')).fields.some(field => field.id === 'expiry')).toBe(false)
  })

  it('keeps required fields per workbook without invalidating existing records', async () => {
    const demo = createDemoRepository()
    const first = await demo.createWorkbook('First')
    const second = await demo.createWorkbook('Second')
    const item = { id: 'one', code: '', name: 'Paper', unit: '', openingBalance: 0, category: '', minimumStock: null, location: '', notes: '', custom: {} }
    await demo.saveItem(first.id, item)
    await demo.addField(first.id, { id: 'batch', name: 'Batch', type: 'text', target: 'items' })
    await demo.saveItemRequirements(first.id, ['name', 'unit', 'field:batch'])
    expect((await demo.loadWorkbook(first.id)).requiredItemFields).toEqual(['name', 'unit', 'field:batch'])
    expect((await demo.loadWorkbook(second.id)).requiredItemFields).toBeUndefined()
    expect((await demo.loadWorkbook(first.id)).items).toContainEqual(item)
    await expect(demo.saveItem(first.id, item)).rejects.toThrow(/required/i)
    await expect(demo.saveItem(first.id, { ...item, unit: 'box', custom: { batch: '  ' } })).rejects.toThrow(/required/i)
    await demo.saveItem(first.id, { ...item, unit: 'box', custom: { batch: 'A' } })
    await expect(demo.saveItemRequirements(first.id, ['unit'])).rejects.toThrow(/invalid/i)
    await expect(demo.saveItemRequirements(first.id, ['name', 'field:missing'])).rejects.toThrow(/invalid/i)
  })

  it('accepts multiple blank codes and rejects stale settings or duplicate nonempty codes', async () => {
    const demo = createDemoRepository()
    const workbook = await demo.createWorkbook('Import')
    const item = { id: 'one', code: '', name: 'Paper', unit: '', openingBalance: 0, category: '', minimumStock: null, location: '', notes: '', custom: {} }
    await demo.appendItems(workbook.id, [item, { ...item, id: 'two' }], ['name', 'openingBalance'])
    await demo.saveItemRequirements(workbook.id, ['name', 'unit'])
    await expect(demo.saveItemRequirements(workbook.id, ['name'], ['name', 'openingBalance'])).rejects.toThrow(/changed/i)
    expect((await demo.loadWorkbook(workbook.id)).requiredItemFields).toEqual(['name', 'unit'])
    await expect(demo.appendItems(workbook.id, [{ ...item, id: 'three', unit: 'box' }], ['name', 'openingBalance'])).rejects.toThrow(/changed/i)
    await expect(demo.saveItem(workbook.id, { ...item, id: 'three', unit: 'box' }, ['name', 'openingBalance'])).rejects.toThrow(/changed/i)
    await expect(demo.appendItems(workbook.id, [{ ...item, id: 'three', unit: 'box', code: 'X' }, { ...item, id: 'four', unit: 'box', code: 'x' }])).rejects.toThrow(/code/i)
    expect((await demo.loadWorkbook(workbook.id)).items).toHaveLength(2)
  })

  it('changes an existing field type only when stored values still fit', async () => {
    const demo = createDemoRepository()
    const [workbook] = await demo.listWorkbooks()
    const data = await demo.loadWorkbook(workbook.id)
    const supplier = data.fields.find(field => field.id === 'demo-supplier')!
    const blocked = await demo.updateField(workbook.id, { ...supplier, type: 'number' }).catch(error => error)
    expect(blocked).toBeInstanceOf(FieldValueError)
    expect(blocked).toMatchObject({ type: 'number', rows: [1, 2] })
    await expect(demo.updateField(workbook.id, { ...supplier, name: 'Renamed' })).rejects.toThrow(/reload/i)
    expect((await demo.loadWorkbook(workbook.id)).fields.find(field => field.id === supplier.id)?.type).toBe('text')

    const numeric = await demo.createWorkbook('Numeric')
    await demo.addField(numeric.id, { id: 'batch', name: 'Batch', type: 'text', target: 'items' })
    await demo.saveItem(numeric.id, { ...data.items[0], id: 'numeric-item', custom: { batch: '42' } })
    await demo.updateField(numeric.id, { id: 'batch', name: 'Batch', type: 'number', target: 'items' })
    expect((await demo.loadWorkbook(numeric.id)).fields).toContainEqual({ id: 'batch', name: 'Batch', type: 'number', target: 'items' })
  })
})
