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
