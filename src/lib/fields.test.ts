import { describe, expect, it } from 'vitest'
import { FieldValueError, isIsoDate, isIsoDateOnly, isValidFieldValue } from './fields'
import { isRepairableIssue } from './schema'
import type { SchemaIssue } from './schema'

describe('field value validation', () => {
  it('accepts empty values and plain text for every type', () => {
    for (const type of ['text', 'number', 'date'] as const) {
      expect(isValidFieldValue(type, '')).toBe(true)
      expect(isValidFieldValue(type, '   ')).toBe(true)
    }
    expect(isValidFieldValue('text', 'LOT-12')).toBe(true)
    expect(isValidFieldValue('number', 'LOT-12')).toBe(false)
  })

  it('accepts locale-independent numbers only', () => {
    expect(isValidFieldValue('number', '1000.5')).toBe(true)
    expect(isValidFieldValue('number', '-2e3')).toBe(true)
    expect(isValidFieldValue('number', '1,000')).toBe(false)
    expect(isValidFieldValue('number', '١٢٣')).toBe(false)
  })

  it('accepts real ISO calendar dates only', () => {
    expect(isValidFieldValue('date', '2026-02-28')).toBe(true)
    expect(isValidFieldValue('date', '2026-02-30')).toBe(false)
    expect(isValidFieldValue('date', '28/02/2026')).toBe(false)
    expect(isIsoDateOnly('2026-02-28')).toBe(true)
    expect(isIsoDate('2026-02-28T10:30:00Z')).toBe(true)
    expect(isIsoDate('2026-02-28T25:00:00Z')).toBe(false)
  })

  it('reports blocked rows in a typed error', () => {
    const error = new FieldValueError('number', [2, 5])
    expect(error).toMatchObject({ name: 'FieldValueError', type: 'number', rows: [2, 5] })
  })
})

describe('schema repair eligibility', () => {
  it('allows only missing optional core columns', () => {
    expect(isRepairableIssue({ code: 'missingCore', target: 'items', coreId: 'notes' })).toBe(true)
    expect(isRepairableIssue({ code: 'missingCore', target: 'movements', coreId: 'party' })).toBe(true)
    expect(isRepairableIssue({ code: 'missingCore', target: 'items', coreId: 'id' })).toBe(false)
    expect(isRepairableIssue({ code: 'duplicateHeader', target: 'items' })).toBe(false)
    const issue: SchemaIssue = { code: 'missingCore', target: 'items', coreId: 'notes' }
    expect(isRepairableIssue(issue)).toBe(true)
  })
})
