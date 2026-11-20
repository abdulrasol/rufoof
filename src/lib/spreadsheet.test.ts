import { describe, expect, it } from 'vitest'
import { parseCsv, toTable } from './spreadsheet'

describe('CSV parsing', () => {
  it('handles quoted fields, escaped quotes, commas and CRLF line endings', () => {
    expect(parseCsv('\ufeffcode,name\r\nA-1,"Paper, white"\r\nA-2,"He said ""hi"""'))
      .toEqual([['code', 'name'], ['A-1', 'Paper, white'], ['A-2', 'He said "hi"']])
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line 1\nline 2",c')).toEqual([['a', 'b'], ['line 1\nline 2', 'c']])
  })

  it('keeps a trailing empty field', () => {
    expect(parseCsv('a,b,\n1,2,')).toEqual([['a', 'b', ''], ['1', '2', '']])
  })

  it('rejects malformed quotes instead of silently merging records', () => {
    expect(() => parseCsv('code,notes\nA,"unclosed\nB,lost')).toThrow(/unreadable/u)
    expect(() => parseCsv('a,b\n1,"text"extra')).toThrow(/unreadable/u)
    expect(() => parseCsv('a,b\n1,te"xt')).toThrow(/unreadable/u)
  })
})

describe('table detection', () => {
  it('skips leading empty rows, trims values and records the header row', () => {
    const table = toTable({
      name: 'Sheet1',
      rows: [
        ['', ''],
        [' Code ', 'Name', 'Unit'],
        ['A-1', 'Paper', 'box'],
        ['', '', ''],
      ],
    })
    expect(table).toMatchObject({ headerRow: 1, headers: ['Code', 'Name', 'Unit'], sheet: 'Sheet1' })
    expect(table.rows).toEqual([['A-1', 'Paper', 'box']])
    expect(table.rowNumbers).toEqual([3])
  })

  it('rejects an empty sheet', () => {
    expect(() => toTable({ name: 'Empty', rows: [['', '']] })).toThrow(/empty/u)
  })
})
