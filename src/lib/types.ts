export type FieldTarget = 'items' | 'movements'
export type FieldType = 'text' | 'number' | 'date'
export type CoreItemField = 'code' | 'name' | 'unit' | 'openingBalance' | 'category' | 'minimumStock' | 'location' | 'notes'
export type ItemRequirement = CoreItemField | `field:${string}`

export interface CustomField {
  id: string
  name: string
  type: FieldType
  target: FieldTarget
}

export interface Item {
  id: string
  code: string
  name: string
  unit: string
  openingBalance: number
  category: string
  minimumStock: number | null
  location: string
  notes: string
  custom: Record<string, string>
}

export type MovementKind = 'in' | 'out' | 'adjustment'

export interface Movement {
  id: string
  itemId: string
  date: string
  kind: MovementKind
  quantity: number
  party: string
  document: string
  notes: string
  custom: Record<string, string>
}

export interface WarehouseData {
  items: Item[]
  movements: Movement[]
  fields: CustomField[]
  requiredItemFields?: ItemRequirement[]
}

export interface WorkbookRef {
  id: string
  name: string
}

export interface GoogleSession {
  accessToken: string
  expiresAt: number
  accountId: string
  email: string
  name: string
}

export interface InventoryRepository {
  listWorkbooks(): Promise<WorkbookRef[]>
  createWorkbook(name: string): Promise<WorkbookRef>
  loadWorkbook(workbookId: string): Promise<WarehouseData>
  saveItem(workbookId: string, item: Item, expectedRequirements?: readonly ItemRequirement[]): Promise<void>
  appendItems(workbookId: string, items: Item[], expectedRequirements?: readonly ItemRequirement[]): Promise<void>
  saveItemRequirements(workbookId: string, required: ItemRequirement[], expectedRequirements?: readonly ItemRequirement[]): Promise<void>
  appendMovements(workbookId: string, movements: Movement[]): Promise<void>
  addField(workbookId: string, field: CustomField): Promise<void>
  updateField(workbookId: string, field: CustomField): Promise<void>
  repairMissingColumn?(workbookId: string, target: FieldTarget, coreId: string): Promise<void>
}
