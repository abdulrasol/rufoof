import type { FieldTarget } from './types'

export type SchemaIssueCode =
  | 'sheetCount'
  | 'sheetDimensions'
  | 'duplicateHeader'
  | 'columnMetadata'
  | 'duplicateCore'
  | 'duplicateField'
  | 'ambiguousCore'
  | 'missingCore'
  | 'dataWithoutHeader'
  | 'invalidRow'
  | 'unknownData'

export interface SchemaIssue {
  code: SchemaIssueCode
  target?: FieldTarget
  column?: string
  row?: number
  coreId?: string
  header?: string
}

export class SchemaIssueError extends Error {
  constructor(readonly issue: SchemaIssue, message?: string) {
    super(message || describeIssue(issue))
    this.name = 'SchemaIssueError'
  }
}

export class WorkbookDataError extends Error {
  constructor(readonly issues: SchemaIssue[] = []) {
    super('Invalid workbook schema or data. Inspect the workbook in Google Sheets.')
    this.name = 'WorkbookDataError'
  }
}

// Core columns that can be appended safely when a workbook is missing them.
// Required columns (IDs, names, quantities) cannot be repaired without guessing data.
export const REPAIRABLE_CORE: Record<FieldTarget, readonly string[]> = {
  items: ['category', 'minimumStock', 'location', 'notes'],
  movements: ['party', 'document', 'notes'],
}

export function isRepairableIssue(issue: SchemaIssue): issue is SchemaIssue & { target: FieldTarget; coreId: string } {
  return issue.code === 'missingCore' && issue.target !== undefined && issue.coreId !== undefined && REPAIRABLE_CORE[issue.target].includes(issue.coreId)
}

export function describeIssue(issue: SchemaIssue): string {
  switch (issue.code) {
    case 'sheetCount': return `Expected one ${issue.target} sheet`
    case 'sheetDimensions': return `Invalid ${issue.target} sheet dimensions`
    case 'duplicateHeader': return `Duplicate header in ${issue.target}: ${issue.header ?? ''}`
    case 'columnMetadata': return `Invalid column metadata in ${issue.target}${issue.column ? ` at ${issue.column}` : ''}`
    case 'duplicateCore': return `Duplicate core metadata ${issue.coreId ?? ''} in ${issue.target}`
    case 'duplicateField': return `Duplicate custom field ID in ${issue.target}`
    case 'ambiguousCore': return `Ambiguous core header ${issue.header ?? ''} in ${issue.target}`
    case 'missingCore': return `Missing core column ${issue.header ?? issue.coreId ?? ''} in ${issue.target}`
    case 'dataWithoutHeader': return `Data in ${issue.target} column ${issue.column ?? ''} has no header`
    case 'invalidRow': return `Invalid data in ${issue.target} row ${issue.row ?? ''}`
    default: return 'Invalid workbook data'
  }
}
