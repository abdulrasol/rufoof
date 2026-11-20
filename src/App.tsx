import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpen, Check,
  ChevronRight, ClipboardCheck, CloudOff, Download, FileSpreadsheet, FolderOpen,
  Languages, Layers3, LayoutDashboard, LogOut, Package, Pencil, Plus, Printer, RefreshCw,
  Search, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Upload, X,
} from 'lucide-react'
import { authorizeGoogle, authorizeGoogleSilently, beginGoogleAuthorization, consumeGoogleAuthorizationCallback, googleRepository, WorkbookDataError, WorkbookDiscoveryError } from './lib/google'
import { deleteSubultechAccount, exchangeGoogleAuthorizationCode, exchangeGoogleToken, fetchApplicationAccess, listSavedWorkbooks, logoutSubultechSession, refreshGoogleAccessToken, refreshSubultechSession, saveWorkbookReference, SubultechError } from './lib/subultech'
import type { ApplicationAccess, SubultechSession } from './lib/subultech'
import { createDemoRepository } from './lib/demo'
import { clearSnapshots, listSnapshots, saveSnapshot } from './lib/cache'
import type { CachedSnapshot } from './lib/cache'
import { DEFAULT_REQUIRED_ITEM_FIELDS, FieldValueError, missingItemRequirements } from './lib/fields'
import { isRepairableIssue } from './lib/schema'
import type { SchemaIssue } from './lib/schema'
import { filterAndSortRows, getBalance, getRunningBalances, movementDelta, toCSV } from './lib/inventory'
import type { TableColumn } from './lib/inventory'
import { buildExportSheets, downloadWorkbook } from './lib/excel'
import { buildPreview, CORE_IMPORTS, editImportTable, mappingProblems, suggestTargets } from './lib/import'
import type { ImportIssueCode, ImportTarget } from './lib/import'
import { clearIdentity, clearSession, isRememberEnabled, loadIdentity, loadLastWorkbook, saveIdentity, saveLastWorkbook, setRememberEnabled } from './lib/session'
import type { LastWorkbook } from './lib/session'
import { readSpreadsheet, SpreadsheetError, toTable } from './lib/spreadsheet'
import type { ImportSheet, ImportTable } from './lib/spreadsheet'
import type { CustomField, FieldTarget, FieldType, GoogleSession, InventoryRepository, Item, ItemRequirement, Movement, WarehouseData, WorkbookRef } from './lib/types'
import { initialLanguage, messages } from './i18n'
import type { Language, MessageKey } from './i18n'
import './styles.css'

type Translate = (key: MessageKey) => string
type Page = 'overview' | 'materials' | 'movements' | 'stockCount' | 'fields' | 'settings'
type Mode = 'google' | 'demo' | 'cache' | null
type PendingCheck = { target: 'item' | 'movement' | 'field'; id: string } | { target: 'items'; items: Item[] } | { target: 'requirements'; fields: ItemRequirement[] }
type Dialog = { kind: 'item'; item?: Item } | { kind: 'movement'; itemId?: string } | { kind: 'detail'; itemId: string } | { kind: 'field'; field?: CustomField } | { kind: 'import' } | null
interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
const coreImportKeys: Record<string, MessageKey> = { code: 'code', name: 'name', unit: 'unit', openingBalance: 'openingBalance', category: 'category', minimumStock: 'minimumStock', location: 'location', notes: 'notes' }
const importIssueKeys: Record<ImportIssueCode, MessageKey> = {
  code: 'importErrCode', name: 'importErrName', unit: 'importErrUnit', openingBalance: 'importErrOpening',
  minimumStock: 'importErrMinimum', customNumber: 'importErrCustomNumber', customDate: 'importErrCustomDate', duplicateCode: 'importErrDuplicate', required: 'importErrRequired',
}
const emptyData: WarehouseData = { items: [], movements: [], fields: [] }
const issueKeys: Record<SchemaIssue['code'], MessageKey> = {
  sheetCount: 'schemaSheetCount', sheetDimensions: 'schemaSheetDimensions', duplicateHeader: 'schemaDuplicateHeader',
  columnMetadata: 'schemaColumnMetadata', duplicateCore: 'schemaDuplicateCore', duplicateField: 'schemaDuplicateField',
  ambiguousCore: 'schemaAmbiguousCore', missingCore: 'schemaMissingCoreRequired', dataWithoutHeader: 'schemaDataWithoutHeader',
  invalidRow: 'schemaInvalidRow', unknownData: 'schemaUnknownData',
}
const coreLabels: Record<string, MessageKey> = { category: 'category', location: 'location', notes: 'notes', minimumStock: 'minimumStock', party: 'party', document: 'document' }
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const numberText = (value: number, language: Language) => new Intl.NumberFormat(language === 'ar' ? 'ar' : 'en', { maximumFractionDigits: 20 }).format(value)
const isLow = (item: Item, data: WarehouseData) => item.minimumStock !== null && getBalance(item, data.movements) <= item.minimumStock
const unauthorized = (error: unknown) => {
  const value = error as { status?: number; code?: number; message?: string } | null
  return value?.status === 401 || value?.code === 401 || /\b401\b|unauthori[sz]ed|token.*expir/i.test(value?.message || '')
}
const loadFailure = (error: unknown): MessageKey => unauthorized(error) ? 'sessionError' : error instanceof WorkbookDataError ? 'workbookDataError' : error instanceof WorkbookDiscoveryError ? 'discoveryError' : 'loadError'

function Brand({ t }: { t: Translate }) {
  return <div className="brand"><a href="https://subultech.top" target="_blank" rel="noreferrer" aria-label="Subul Technology"><img src="/brand.svg" alt={`${t('appName')} — ${t('ledger')}`} style={{ display: 'block', width: '188px', maxWidth: '100%', height: 'auto' }} /></a></div>
}

function Modal({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const focusable = () => Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') || [])
    ;(focusable()[0] || node)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (!controls.length) { event.preventDefault(); node?.focus(); return }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1}><div className="modal-heading"><div><span className="eyebrow">RUFOOF / {title}</span><h2 id="dialog-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}><X size={19} /></button></div>{children}</div></div>
}

function FormField({ label, children, hint, wide, required }: { label: string; children: ReactNode; hint?: string; wide?: boolean; required?: boolean }) {
  return <label className={`form-field${wide ? ' form-wide' : ''}`}><span>{label}{required && ' *'}</span>{children}{hint && <small>{hint}</small>}</label>
}

function CustomInputs({ fields, target, values, onChange, t, required = [] }: { fields: CustomField[]; target: FieldTarget; values: Record<string, string>; onChange: (values: Record<string, string>) => void; t: Translate; required?: readonly ItemRequirement[] }) {
  const defined = fields.filter((field) => field.target === target)
  const unknown = Object.keys(values).filter((key) => !defined.some((field) => field.id === key))
  if (!defined.length && !unknown.length) return null
  return <div className="form-wide custom-fields"><h3>{t('customDetails')}</h3><p className="form-hint">{t('customFieldHelp')}</p><div className="form-grid">{defined.map((field) => <FormField key={field.id} label={field.name} required={required.includes(`field:${field.id}`)}><input required={required.includes(`field:${field.id}`)} type={field.type} step={field.type === 'number' ? 'any' : undefined} value={values[field.id] ?? ''} onChange={(event) => onChange({ ...values, [field.id]: event.target.value })} /></FormField>)}{unknown.map((key) => <FormField key={key} label={`${key} · ${t('unknownField')}`}><input value={values[key]} onChange={(event) => onChange({ ...values, [key]: event.target.value })} /></FormField>)}</div></div>
}

function ItemEditor({ item, fields, required, t, disabled, busy, notice, onSave, onClose }: { item?: Item; fields: CustomField[]; required: readonly ItemRequirement[]; t: Translate; disabled: boolean; busy: boolean; notice: ReactNode; onSave: (item: Item) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState({ code: item?.code ?? '', name: item?.name ?? '', unit: item?.unit ?? '', openingBalance: item ? String(item.openingBalance) : '', category: item?.category ?? '', minimumStock: item?.minimumStock == null ? '' : String(item.minimumStock), location: item?.location ?? '', notes: item?.notes ?? '', custom: { ...item?.custom } })
  const [error, setError] = useState<MessageKey | null>(null)
  const [draftId] = useState(() => item?.id ?? crypto.randomUUID())
  const update = (key: keyof typeof draft, value: string) => setDraft((old) => ({ ...old, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const openingBalance = Number(draft.openingBalance)
    const minimumStock = draft.minimumStock === '' ? null : Number(draft.minimumStock)
    if (!Number.isFinite(openingBalance) || (minimumStock !== null && (!Number.isFinite(minimumStock) || minimumStock < 0))) { setError('invalidNumber'); return }
    const next = { ...item, id: draftId, ...draft, code: draft.code.trim(), name: draft.name.trim(), unit: draft.unit.trim(), openingBalance, minimumStock }
    if ((required.includes('openingBalance') && !draft.openingBalance.trim()) || missingItemRequirements(next, required).length) { setError('requiredFieldsError'); return }
    setError(null)
    if (await onSave(next)) onClose()
  }
  return <form onSubmit={submit}><div className="modal-body">{notice}<div className="form-grid"><FormField label={t('code')} required={required.includes('code')}><input required={required.includes('code')} value={draft.code} onChange={(e) => update('code', e.target.value)} /></FormField><FormField label={t('name')} required><input required value={draft.name} onChange={(e) => update('name', e.target.value)} /></FormField><FormField label={t('unit')} required={required.includes('unit')}><input required={required.includes('unit')} value={draft.unit} onChange={(e) => update('unit', e.target.value)} /></FormField><FormField label={t('category')} required={required.includes('category')}><input required={required.includes('category')} value={draft.category} onChange={(e) => update('category', e.target.value)} /></FormField><FormField label={t('openingBalance')} required={required.includes('openingBalance')} hint={item ? t('openingLocked') : undefined}><input required={required.includes('openingBalance')} type="number" step="any" readOnly={!!item} value={draft.openingBalance} onChange={(e) => update('openingBalance', e.target.value)} /></FormField><FormField label={t('minimumStock')} required={required.includes('minimumStock')}><input required={required.includes('minimumStock')} type="number" step="any" min="0" value={draft.minimumStock} onChange={(e) => update('minimumStock', e.target.value)} /></FormField><FormField label={t('location')} required={required.includes('location')}><input required={required.includes('location')} value={draft.location} onChange={(e) => update('location', e.target.value)} /></FormField><FormField label={t('notes')} required={required.includes('notes')} wide><textarea required={required.includes('notes')} rows={3} value={draft.notes} onChange={(e) => update('notes', e.target.value)} /></FormField><CustomInputs fields={fields} target="items" required={required} values={draft.custom} onChange={(custom) => setDraft((old) => ({ ...old, custom }))} t={t} /></div>{error && <p className="inline-error" role="alert">{t(error)}</p>}</div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={disabled}>{busy ? t('saving') : t('save')}</button></div></form>
}

function MovementEditor({ initialItemId, data, t, disabled, busy, notice, onSave, onClose }: { initialItemId?: string; data: WarehouseData; t: Translate; disabled: boolean; busy: boolean; notice: ReactNode; onSave: (movement: Movement) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState({ itemId: initialItemId ?? '', date: today(), kind: 'in' as 'in' | 'out', quantity: '', party: '', document: '', notes: '', custom: {} as Record<string, string> })
  const [draftId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState(false)
  const [acceptedNegative, setAcceptedNegative] = useState('')
  const selectedItem = data.items.find((item) => item.id === draft.itemId)
  const balance = selectedItem ? getBalance(selectedItem, data.movements) : null
  const negativeKey = draft.kind === 'out' && balance !== null && Number(draft.quantity) > 0 && Number(draft.quantity) > balance
    ? JSON.stringify([draft.itemId, draft.quantity, balance]) : ''
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const quantity = Number(draft.quantity)
    if (!draft.itemId || !Number.isFinite(quantity) || quantity <= 0) { setError(true); return }
    if (negativeKey && acceptedNegative !== negativeKey) return
    setError(false)
    if (await onSave({ ...draft, id: draftId, quantity })) onClose()
  }
  return <form onSubmit={submit}><div className="modal-body">{notice}<p className="form-intro">{t('movementHint')}</p><div className="form-grid"><FormField label={t('material')} wide><select required value={draft.itemId} onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}><option value="">{t('selectMaterial')}</option>{data.items.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></FormField><FormField label={t('type')}><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'in' | 'out' })}><option value="in">{t('in')}</option><option value="out">{t('out')}</option></select></FormField><FormField label={t('date')}><input required type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></FormField><FormField label={t('quantity')}><input required type="number" min="0.00000001" step="any" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} /></FormField><FormField label={t('party')}><input value={draft.party} onChange={(e) => setDraft({ ...draft, party: e.target.value })} /></FormField><FormField label={t('document')} wide><input value={draft.document} onChange={(e) => setDraft({ ...draft, document: e.target.value })} /></FormField><FormField label={t('notes')} wide><textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></FormField><CustomInputs fields={data.fields} target="movements" values={draft.custom} onChange={(custom) => setDraft({ ...draft, custom })} t={t} /></div>{negativeKey && <label className="message warning"><input type="checkbox" required checked={acceptedNegative === negativeKey} onChange={(event) => setAcceptedNegative(event.target.checked ? negativeKey : '')} /><span>{t('negativeStock')}</span></label>}{error && <p className="inline-error" role="alert">{t('invalidNumber')}</p>}</div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={disabled}>{busy ? t('saving') : t('recordMovement')}</button></div></form>
}

function FieldEditor({ field, t, disabled, busy, notice, onSave, onClose }: { field?: CustomField; t: Translate; disabled: boolean; busy: boolean; notice: ReactNode; onSave: (field: CustomField) => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState(field?.name ?? '')
  const [type, setType] = useState<FieldType>(field?.type ?? 'text')
  const [target, setTarget] = useState<FieldTarget>(field?.target ?? 'items')
  const [draftId] = useState(() => field?.id ?? crypto.randomUUID())
  const submit = async (event: FormEvent) => { event.preventDefault(); if (name.trim() && await onSave({ id: draftId, name: name.trim(), type, target })) onClose() }
  return <form onSubmit={submit}><div className="modal-body">{notice}{field && <p className="form-intro">{t('fieldEditHint')}</p>}<div className="form-grid"><FormField label={t('fieldName')} wide><input required readOnly={!!field} value={name} onChange={(e) => setName(e.target.value)} /></FormField><FormField label={t('fieldType')} hint={field ? t('fieldTypeHint') : undefined}><select value={type} onChange={(e) => setType(e.target.value as FieldType)}><option value="text">{t('text')}</option><option value="number">{t('number')}</option><option value="date">{t('dateField')}</option></select></FormField><FormField label={t('fieldTarget')}><select disabled={!!field} value={target} onChange={(e) => setTarget(e.target.value as FieldTarget)}><option value="items">{t('materials')}</option><option value="movements">{t('movements')}</option></select></FormField></div></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={disabled}>{busy ? t('saving') : field ? t('save') : t('addField')}</button></div></form>
}

function ImportDialog({ existingCodes, fields, required, t, language, busy, disabled, notice, onImport, onClose }: { existingCodes: string[]; fields: CustomField[]; required: readonly ItemRequirement[]; t: Translate; language: Language; busy: boolean; disabled: boolean; notice: ReactNode; onImport: (items: Item[]) => Promise<boolean>; onClose: () => void }) {
  const [sheets, setSheets] = useState<ImportSheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [table, setTable] = useState<ImportTable | null>(null)
  const [targets, setTargets] = useState<ImportTarget[]>([])
  const [edits, setEdits] = useState<Record<number, Record<number, string>>>({})
  const [skippedRows, setSkippedRows] = useState<Set<number>>(() => new Set())
  const [reviewPage, setReviewPage] = useState(0)
  const [fileError, setFileError] = useState<MessageKey | null>(null)
  const [reading, setReading] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const itemFields = fields.filter((field) => field.target === 'items')
  const problems = table ? mappingProblems(targets, required) : null
  const preview = useMemo(() => {
    if (!table) return null
    const check = mappingProblems(targets, required)
    if (check.missing.length || check.duplicate.length) return null
    return buildPreview(editImportTable(table, edits, skippedRows), targets, fields, existingCodes, required)
  }, [table, targets, fields, existingCodes, required, edits, skippedRows])
  const issuesByRow = useMemo(() => new Map(preview?.issues.map((issue) => [issue.row, issue]) ?? []), [preview])
  const existingRows = useMemo(() => new Set(preview?.existingRows ?? []), [preview])
  const reviewRows = table && preview ? table.rowNumbers.filter((row) => issuesByRow.has(row) || row in edits || skippedRows.has(row)) : []
  const rowIndexes = useMemo(() => new Map(table?.rowNumbers.map((row, index) => [row, index]) ?? []), [table])
  const reviewPages = Math.ceil(reviewRows.length / 20)
  const page = Math.min(reviewPage, Math.max(0, reviewPages - 1))
  const reviewPagination = reviewPages > 1 && <div className="import-review-pagination"><button type="button" className="button secondary" disabled={page === 0 || busy || reading} onClick={() => setReviewPage(page - 1)}>{t('importPreviousPage')}</button><span>{t('importPage')} {numberText(page + 1, language)} / {numberText(reviewPages, language)}</span><button type="button" className="button secondary" disabled={page + 1 >= reviewPages || busy || reading} onClick={() => setReviewPage(page + 1)}>{t('importNextPage')}</button></div>
  const resetReview = () => { setEdits({}); setSkippedRows(new Set()); setReviewPage(0) }
  const updateCell = (row: number, column: number, value: string) => setEdits((current) => ({ ...current, [row]: { ...current[row], [column]: value } }))
  const toggleRow = (row: number) => setSkippedRows((current) => {
    const next = new Set(current)
    if (next.has(row)) next.delete(row)
    else next.add(row)
    return next
  })
  const useTable = (next: ImportTable) => { setTable(next); setTargets(suggestTargets(next.headers, fields)); setFileError(null); resetReview() }
  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setReading(true); setFileError(null); setTable(null); setSheets([]); setTargets([]); resetReview()
    try {
      const loaded = await readSpreadsheet(file)
      setSheets(loaded); setSheetIndex(0)
      try { useTable(toTable(loaded[0])) } catch (cause) { setTable(null); setTargets([]); setFileError(cause instanceof SpreadsheetError && cause.code === 'tooLarge' ? 'importTooLarge' : 'importEmpty') }
    } catch (cause) {
      setSheets([]); setTable(null); setTargets([])
      const map = { unsupported: 'importUnsupported', empty: 'importEmpty', tooLarge: 'importTooLarge', unreadable: 'importReadError' } as const
      setFileError(cause instanceof SpreadsheetError ? map[cause.code] : 'importReadError')
    } finally { setReading(false); if (picker.current) picker.current.value = '' }
  }
  const chooseSheet = (index: number) => {
    setSheetIndex(index); resetReview()
    try { useTable(toTable(sheets[index])) } catch (cause) { setTable(null); setTargets([]); setFileError(cause instanceof SpreadsheetError && cause.code === 'tooLarge' ? 'importTooLarge' : 'importEmpty') }
  }
  const samples = useMemo(() => table?.headers.map((_, index) => {
    const values: string[] = []
    for (const row of table.rows) {
      const value = row[index]
      if (value && !values.includes(value)) values.push(value)
      if (values.length === 3) break
    }
    return values
  }) ?? [], [table])
  return <>
    <div className="modal-body">
      {notice}
      <p className="form-intro">{t('importHint')}</p>
      <div className="import-file">
        <input ref={picker} className="sr-only" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void loadFile(event.target.files?.[0])} />
        <button type="button" className="button secondary" disabled={reading || busy} onClick={() => picker.current?.click()}><Upload size={16} />{reading ? t('loading') : t('importChooseFile')}</button>
        {sheets.length > 1 ? <label className="import-sheet"><span>{t('importSheet')}</span><select disabled={busy || reading} value={sheetIndex} onChange={(event) => chooseSheet(Number(event.target.value))}>{sheets.map((sheet, index) => <option key={`${sheet.name}-${index}`} value={index}>{sheet.name}</option>)}</select></label>
          : sheets.length === 1 ? <span className="import-file-name" dir="auto">{sheets[0].name}</span> : <span className="muted">{t('importNoFile')}</span>}
      </div>
      {fileError && <div className="message error" role="alert"><AlertCircle size={17} /><span>{t(fileError)}</span></div>}
      {table && problems && <>
        {(problems.missing.length > 0 || problems.duplicate.length > 0) && <div className="message warning" role="alert"><AlertCircle size={17} /><span>{problems.missing.length ? `${t('importMissingFields')}: ${problems.missing.map((target) => requirementLabel(target, fields, t)).join(', ')}` : t('importDuplicateMapping')}</span></div>}
        <div className="import-map">{table.headers.map((header, index) => <div className="import-row" key={`${header}-${index}`}>
          <div className="import-source"><strong dir="auto">{header || `${t('importColumn')} ${index + 1}`}</strong><span className="import-sample-label">{t('importSamples')}</span><div className="import-samples">{samples[index]?.length ? samples[index].map((value) => <span className="import-sample" key={value} dir="auto" title={value}>{value}</span>) : <span className="import-sample-empty">{t('importNoValues')}</span>}</div></div>
          <ArrowRight size={15} className="import-arrow" />
          <label className="import-target"><span className="sr-only">{t('importTarget')}</span><select aria-label={`${t('importTarget')}: ${header || `${t('importColumn')} ${index + 1}`}`} disabled={busy || reading} value={targets[index] ?? ''} onChange={(event) => { const value = event.target.value as ImportTarget; setTargets((current) => current.map((target, position) => position === index ? value : target)); setReviewPage(0) }}><option value="">{t('importIgnore')}</option>{CORE_IMPORTS.map((target) => <option key={target} value={target}>{t(coreImportKeys[target])}</option>)}{itemFields.map((field) => <option key={field.id} value={`field:${field.id}`}>{field.name}</option>)}</select></label>
        </div>)}</div>
        {preview && <>
          <p className="import-summary"><strong>{numberText(preview.items.length, language)}</strong> {t('importReady')} <span>·</span> <strong>{numberText(preview.skipped, language)}</strong> {t('importSkipped')}{skippedRows.size > 0 && <> <span>·</span> <strong>{numberText(skippedRows.size, language)}</strong> {t('importManuallySkipped')}</>}{preview.issues.length > 0 && <> <span>·</span> <strong>{numberText(preview.issues.length, language)}</strong> {t('importIssues')}</>}</p>
          {preview.items.length > 0 && <div className="table-scroll import-preview"><table><thead><tr><th>{t('code')}</th><th>{t('name')}</th><th>{t('unit')}</th><th className="number-cell">{t('openingBalance')}</th></tr></thead><tbody>{preview.items.slice(0, 6).map((item) => <tr key={item.id}><td><span className="code">{item.code}</span></td><td>{item.name}</td><td>{item.unit}</td><td className="number-cell">{numberText(item.openingBalance, language)}</td></tr>)}</tbody></table></div>}
          {reviewRows.length > 0 && <section className="import-review" aria-label={t('importReview')}>
            <h3>{t('importReview')}</h3>
            <p className="form-hint">{t('importIssuesNote')}</p>
            {reviewPagination}
            <div className="import-review-list">{reviewRows.slice(page * 20, (page + 1) * 20).map((rowNumber) => {
              const index = rowIndexes.get(rowNumber)!
              const issue = issuesByRow.get(rowNumber)
              const skipped = skippedRows.has(rowNumber)
              const issueTarget = issue?.field ?? (issue?.code === 'duplicateCode' ? 'code' : issue?.code)
              const status = skipped ? t('importRowSkipped') : issue ? `${t(importIssueKeys[issue.code])}${issue.field ? `: ${requirementLabel(issue.field, fields, t)}` : ''}` : existingRows.has(rowNumber) ? t('importRowExisting') : t('importRowReady')
              return <article className={`import-review-card${skipped ? ' is-skipped' : ''}`} key={rowNumber}>
                <div className="import-review-heading"><strong>{t('schemaRowLabel')} {numberText(rowNumber, language)}</strong><button type="button" className="button secondary" disabled={busy || reading} aria-label={`${t(skipped ? 'importRestoreRow' : 'importSkipRow')} ${t('schemaRowLabel')} ${rowNumber}`} onClick={() => toggleRow(rowNumber)}>{t(skipped ? 'importRestoreRow' : 'importSkipRow')}</button></div>
                <p id={`import-row-status-${rowNumber}`} className={`import-review-status${issue && !skipped ? ' is-error' : ''}`}>{status}</p>
                {!skipped && <div className="import-review-fields">{targets.map((target, column) => {
                  if (!target) return null
                  const label = requirementLabel(target, fields, t)
                  const value = edits[rowNumber]?.[column] ?? table.rows[index]?.[column] ?? ''
                  const invalid = issueTarget === target
                  const props = { value, disabled: busy || reading, 'aria-label': `${t('schemaRowLabel')} ${rowNumber} - ${label}`, 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? `import-row-status-${rowNumber}` : undefined, dir: 'auto' as const }
                  return <label className="form-field" key={column}><span>{label}</span>{target === 'notes' ? <textarea {...props} rows={2} onChange={(event) => updateCell(rowNumber, column, event.target.value)} /> : <input {...props} inputMode={target === 'openingBalance' || target === 'minimumStock' || itemFields.some((field) => target === `field:${field.id}` && field.type === 'number') ? 'decimal' : undefined} onChange={(event) => updateCell(rowNumber, column, event.target.value)} />}</label>
                })}</div>}
              </article>
            })}</div>
            {reviewPagination}
          </section>}
          <p className="form-hint">{t('importExistingNote')}</p>
        </>}
      </>}
    </div>
    <div className="modal-actions">
      <button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button>
      <button type="button" className="button primary" disabled={disabled || busy || reading || !preview || preview.items.length === 0 || preview.issues.length > 0} onClick={() => { if (preview) void onImport(preview.items) }}>{busy ? t('saving') : t('importConfirm')}</button>
    </div>
  </>
}

function requirementLabel(requirement: ItemRequirement, fields: CustomField[], t: Translate): string {
  return requirement.startsWith('field:') ? fields.find((field) => field.target === 'items' && field.id === requirement.slice(6))?.name ?? requirement.slice(6) : t(coreImportKeys[requirement])
}

function RequirementSettings({ fields, required, disabled, busy, t, onSave }: { fields: CustomField[]; required: readonly ItemRequirement[]; disabled: boolean; busy: boolean; t: Translate; onSave: (required: ItemRequirement[]) => Promise<boolean> }) {
  const [selected, setSelected] = useState<ItemRequirement[]>([...required])
  useEffect(() => { setSelected([...required]) }, [required])
  const options: ItemRequirement[] = [...CORE_IMPORTS, ...fields.filter((field) => field.target === 'items').map((field): ItemRequirement => `field:${field.id}`)]
  const changed = selected.length !== required.length || selected.some((field) => !required.includes(field))
  return <section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('requiredFieldsTitle')}</span></div><div className="settings-content"><p className="setting-note">{t('requiredFieldsHint')}</p><p className="form-hint">{t('requiredFieldsName')} {t('requiredFieldsBalance')}</p><div className="required-fields">{options.map((field) => <label key={field}><input type="checkbox" checked={selected.includes(field)} disabled={disabled || field === 'name'} onChange={(event) => setSelected((current) => event.target.checked ? [...current, field] : current.filter((value) => value !== field))} /><span>{requirementLabel(field, fields, t)}</span></label>)}</div><div className="setting-actions"><button type="button" className="button primary" disabled={disabled || !changed} onClick={() => void onSave(selected)}>{busy ? t('saving') : t('save')}</button></div></div></section>
}

function SchemaIssuePanel({ issue, t, busy, canRepair, onRepair, onReload }: { issue: SchemaIssue; t: Translate; busy: boolean; canRepair: boolean; onRepair: () => void; onReload: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const repairable = isRepairableIssue(issue)
  const details: Array<[string, string]> = []
  if (issue.target) details.push([t('schemaSheetLabel'), issue.target])
  if (issue.column) details.push([t('schemaColumnLabel'), issue.column])
  if (issue.row !== undefined) details.push([t('schemaRowLabel'), String(issue.row)])
  if (issue.header) details.push([t('schemaHeaderLabel'), issue.header])
  if (repairable) details.push([t('fieldName'), t(coreLabels[issue.coreId] ?? 'unknownField')])
  return <div className="verification-panel" role="alert">
    <strong>{t('schemaTitle')}</strong>
    <p>{t(repairable ? 'schemaMissingCoreOptional' : issueKeys[issue.code])}</p>
    {details.length > 0 && <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto">{value || '—'}</dd></div>)}</dl>}
    {confirming ? <><p>{t('schemaRepairConfirm')}</p><div className="setting-actions"><button type="button" className="button primary" disabled={busy} onClick={onRepair}>{t('schemaAddColumn')}</button><button type="button" className="button secondary" onClick={() => setConfirming(false)}>{t('cancel')}</button></div></> : <div className="setting-actions"><button type="button" className="button secondary" disabled={busy} onClick={onReload}>{t('schemaReload')}</button>{repairable && canRepair && <button type="button" className="button primary" disabled={busy} onClick={() => setConfirming(true)}>{t('schemaAddColumn')}</button>}</div>}
  </div>
}

function Empty({ title, text, icon = <Package size={21} /> }: { title: string; text: string; icon?: ReactNode }) {
  return <div className="empty"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{text}</p></div>
}

function Status({ item, data, t }: { item: Item; data: WarehouseData; t: Translate }) {
  const low = isLow(item, data)
  return <span className={`stamp ${low ? 'stamp-low' : item.minimumStock === null ? 'stamp-neutral' : 'stamp-good'}`}><span />{low ? t('low') : item.minimumStock === null ? t('noMinimum') : t('healthy')}</span>
}

type DisplayColumn<T> = TableColumn<T> & { label: string; render?: (row: T) => ReactNode; className?: string }

function FilterTable<T>({ rows, columns, rowKey, t, language, limit, action }: { rows: T[]; columns: DisplayColumn<T>[]; rowKey: (row: T) => string; t: Translate; language: Language; limit?: number; action?: (row: T) => ReactNode }) {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const matching = filterAndSortRows(rows, columns, filters, sort, language)
  const shown = limit === undefined ? matching : matching.slice(0, limit)
  const active = !!sort || Object.values(filters).some((value) => value !== '')
  return <>
    <div className="table-tools"><span aria-live="polite">{t('tableResults')}: {numberText(matching.length, language)}{limit !== undefined && matching.length > limit && <> · {t('tableShowing')} {numberText(shown.length, language)} {t('tableOf')} {numberText(matching.length, language)}</>}</span>{active && <button type="button" className="table-clear" onClick={() => { setFilters({}); setSort(null) }}>{t('tableReset')}</button>}</div>
    <div className="table-scroll-hint">{t('tableScrollHint')}</div>
    <div className="table-scroll"><table><thead><tr>{columns.map((column) => {
      const direction = sort?.key === column.key ? sort.direction : null
      const next = direction === 'asc' ? 'sortDescending' : 'sortAscending'
      return <th key={column.key} scope="col" className={column.className} aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}><button type="button" className={`table-sort${direction ? ' is-active' : ''}`} aria-label={`${t(next)}: ${column.label}`} title={t(next)} onClick={() => setSort({ key: column.key, direction: direction === 'asc' ? 'desc' : 'asc' })}><span>{column.label}</span><span className="table-sort-icon" aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span></button></th>
    })}{action && <th className="print-action"><span className="sr-only">{t('actions')}</span></th>}</tr><tr className="table-filter-row">{columns.map((column) => <th key={column.key}><input type="search" aria-label={`${t('searchColumn')}: ${column.label}`} placeholder={t('search')} value={filters[column.key] ?? ''} onChange={(event) => setFilters((current) => ({ ...current, [column.key]: event.target.value }))} /></th>)}{action && <th className="print-action" />}</tr></thead><tbody>{shown.length ? shown.map((row) => <tr key={rowKey(row)}>{columns.map((column) => { const value = column.value(row); return <td key={column.key} className={column.className}>{column.render ? column.render(row) : value === '' || value == null ? '—' : value}</td> })}{action && <td className="print-action">{action(row)}</td>}</tr>) : <tr><td className="table-no-results" colSpan={columns.length + (action ? 1 : 0)}><span>{t('noResults')}</span></td></tr>}</tbody></table></div>
  </>
}

function MaterialsTable({ items, data, hiddenFields, t, language, onDetail, limit }: { items: Item[]; data: WarehouseData; hiddenFields: string[]; t: Translate; language: Language; onDetail: (id: string) => void; limit?: number }) {
  const fields = data.fields.filter((field) => field.target === 'items' && !hiddenFields.includes(field.id))
  const balances = new Map(items.map((item) => [item.id, getBalance(item, data.movements)]))
  const status = (item: Item) => item.minimumStock === null ? t('noMinimum') : balances.get(item.id)! <= item.minimumStock ? t('low') : t('healthy')
  const columns: DisplayColumn<Item>[] = [
    { key: 'code', label: t('code'), value: (item) => item.code, render: (item) => <span className="code">{item.code}</span> },
    { key: 'name', label: t('material'), value: (item) => item.name, render: (item) => <button className="table-link" onClick={() => onDetail(item.id)}>{item.name}</button> },
    { key: 'category', label: t('category'), value: (item) => item.category },
    { key: 'location', label: t('location'), value: (item) => item.location },
    ...fields.map((field): DisplayColumn<Item> => ({ key: `custom:${field.id}`, label: field.name, type: field.type, value: (item) => item.custom[field.id] })),
    { key: 'balance', label: t('currentBalance'), type: 'number', className: 'number-cell', value: (item) => balances.get(item.id), searchValue: (item) => numberText(balances.get(item.id)!, language), render: (item) => <span className="balance">{numberText(balances.get(item.id)!, language)}</span> },
    { key: 'status', label: t('status'), value: status, render: (item) => <Status item={item} data={data} t={t} /> },
    { key: 'unit', label: t('unit'), value: (item) => item.unit },
    { key: 'opening', label: t('openingBalance'), type: 'number', className: 'number-cell', value: (item) => item.openingBalance, searchValue: (item) => numberText(item.openingBalance, language), render: (item) => numberText(item.openingBalance, language) },
    { key: 'minimum', label: t('minimumStock'), type: 'number', className: 'number-cell', value: (item) => item.minimumStock, searchValue: (item) => item.minimumStock === null ? '' : numberText(item.minimumStock, language), render: (item) => item.minimumStock === null ? '—' : numberText(item.minimumStock, language) },
    { key: 'notes', label: t('notes'), value: (item) => item.notes },
  ]
  return <FilterTable rows={items} columns={columns} rowKey={(item) => item.id} t={t} language={language} limit={limit} action={(item) => <button className="row-action" onClick={() => onDetail(item.id)} aria-label={`${t('details')}: ${item.name}`}><ChevronRight size={17} /></button>} />
}

function MovementTable({ movements, data, hiddenFields, t, language, limit }: { movements: Movement[]; data: WarehouseData; hiddenFields: string[]; t: Translate; language: Language; limit?: number }) {
  const fields = data.fields.filter((field) => field.target === 'movements' && !hiddenFields.includes(field.id))
  const items = new Map(data.items.map((item) => [item.id, item]))
  const columns: DisplayColumn<Movement>[] = [
    { key: 'date', label: t('date'), type: 'date', value: (movement) => movement.date },
    { key: 'material', label: t('material'), value: (movement) => items.get(movement.itemId)?.name || movement.itemId, render: (movement) => <strong>{items.get(movement.itemId)?.name || movement.itemId}</strong> },
    { key: 'type', label: t('type'), value: (movement) => t(movement.kind), render: (movement) => <span className={`movement-type ${movement.kind}`}><span className="movement-icon">{movement.kind === 'in' ? <ArrowDownLeft size={14} /> : movement.kind === 'out' ? <ArrowUpRight size={14} /> : <SlidersHorizontal size={14} />}</span>{t(movement.kind)}</span> },
    { key: 'quantity', label: t('quantity'), type: 'number', className: 'number-cell', value: movementDelta, searchValue: (movement) => `${movementDelta(movement) > 0 ? '+' : ''}${numberText(movementDelta(movement), language)}`, render: (movement) => <span className={`balance ${movementDelta(movement) > 0 ? 'positive' : ''}`}>{movementDelta(movement) > 0 ? '+' : ''}{numberText(movementDelta(movement), language)}</span> },
    { key: 'party', label: t('party'), value: (movement) => movement.party },
    { key: 'document', label: t('document'), value: (movement) => movement.document },
    ...fields.map((field): DisplayColumn<Movement> => ({ key: `custom:${field.id}`, label: field.name, type: field.type, value: (movement) => movement.custom[field.id] })),
    { key: 'code', label: t('code'), value: (movement) => items.get(movement.itemId)?.code },
    { key: 'unit', label: t('unit'), value: (movement) => items.get(movement.itemId)?.unit },
    { key: 'notes', label: t('notes'), value: (movement) => movement.notes },
  ]
  return <FilterTable rows={movements} columns={columns} rowKey={(movement) => movement.id} t={t} language={language} limit={limit} />
}

function FieldsTable({ fields, hiddenFields, setHiddenFields, writable, t, language, onEdit }: { fields: CustomField[]; hiddenFields: string[]; setHiddenFields: (update: (current: string[]) => string[]) => void; writable: boolean; t: Translate; language: Language; onEdit: (field: CustomField) => void }) {
  const columns: DisplayColumn<CustomField>[] = [
    { key: 'name', label: t('fieldName'), value: (field) => field.name, render: (field) => <strong>{field.name}</strong> },
    { key: 'type', label: t('fieldType'), value: (field) => t(field.type === 'date' ? 'dateField' : field.type) },
    { key: 'target', label: t('fieldTarget'), value: (field) => t(field.target === 'items' ? 'materials' : 'movements') },
    { key: 'visible', label: t('fieldVisible'), value: (field) => t(hiddenFields.includes(field.id) ? 'tableHidden' : 'tableVisible'), render: (field) => <input type="checkbox" aria-label={`${t('fieldVisible')}: ${field.name}`} checked={!hiddenFields.includes(field.id)} onChange={(event) => setHiddenFields((current) => event.target.checked ? current.filter((id) => id !== field.id) : [...current, field.id])} /> },
  ]
  return <FilterTable rows={fields} columns={columns} rowKey={(field) => field.id} t={t} language={language} action={(field) => <button className="row-action" disabled={!writable} onClick={() => onEdit(field)} aria-label={`${t('editField')}: ${field.name}`}><Pencil size={16} /></button>} />
}

function ItemDetail({ item, data, t, language, writable, onEdit, onMove }: { item: Item; data: WarehouseData; t: Translate; language: Language; writable: boolean; onEdit: () => void; onMove: () => void }) {
  const history = getRunningBalances(item, data.movements)
  const custom = Object.entries(item.custom)
  const movementFields = data.fields.filter((field) => field.target === 'movements')
  const unknown = [...new Set(history.flatMap(({ movement }) => Object.keys(movement.custom)))].filter((id) => !movementFields.some((field) => field.id === id))
  type HistoryRow = (typeof history)[number]
  const columns: DisplayColumn<HistoryRow>[] = [
    { key: 'date', label: t('date'), type: 'date', value: ({ movement }) => movement.date },
    { key: 'type', label: t('type'), value: ({ movement }) => t(movement.kind) },
    { key: 'document', label: t('document'), value: ({ movement }) => movement.document },
    { key: 'quantity', label: t('quantity'), type: 'number', className: 'number-cell', value: ({ movement }) => movementDelta(movement), searchValue: ({ movement }) => numberText(movementDelta(movement), language), render: ({ movement }) => numberText(movementDelta(movement), language) },
    { key: 'balance', label: t('balanceAfter'), type: 'number', className: 'number-cell balance', value: ({ balance }) => balance, searchValue: ({ balance }) => numberText(balance, language), render: ({ balance }) => numberText(balance, language) },
    { key: 'party', label: t('party'), value: ({ movement }) => movement.party },
    { key: 'notes', label: t('notes'), value: ({ movement }) => movement.notes },
    ...movementFields.map((field): DisplayColumn<HistoryRow> => ({ key: `custom:${field.id}`, label: field.name, type: field.type, value: ({ movement }) => movement.custom[field.id] })),
    ...unknown.map((id): DisplayColumn<HistoryRow> => ({ key: `custom:${id}`, label: id, value: ({ movement }) => movement.custom[id] })),
  ]
  return <div className="modal-body detail-body"><div className="detail-top"><div><span className="code">{item.code}</span><h3>{item.name}</h3><p>{item.category || '—'} <span>·</span> {item.location || '—'}</p></div><div className="detail-balance"><small>{t('currentBalance')}</small><strong>{numberText(getBalance(item, data.movements), language)} <span>{item.unit}</span></strong><Status item={item} data={data} t={t} /></div></div><div className="detail-actions"><button className="button secondary" disabled={!writable} onClick={onEdit}><Plus size={16} />{t('editMaterial')}</button><button className="button primary" disabled={!writable} onClick={onMove}><Plus size={16} />{t('recordMovement')}</button></div><div className="detail-meta"><div><small>{t('openingBalance')}</small><strong>{numberText(item.openingBalance, language)} {item.unit}</strong></div><div><small>{t('minimumStock')}</small><strong>{item.minimumStock === null ? '—' : numberText(item.minimumStock, language)}</strong></div><div><small>{t('notes')}</small><strong>{item.notes || '—'}</strong></div>{custom.map(([key, value]) => <div key={key}><small>{data.fields.find((field) => field.target === 'items' && field.id === key)?.name || key}</small><strong>{value || '—'}</strong></div>)}</div><div className="section-heading compact"><div><span className="eyebrow">{t('ledger')}</span><h3>{t('movementHistory')}</h3></div><span className="section-count">{history.length}</span></div>{history.length ? <FilterTable rows={history} columns={columns} rowKey={({ movement }) => movement.id} t={t} language={language} /> : <Empty title={t('noMovements')} text={t('noMovementsText')} icon={<Activity size={21} />} />}</div>
}

const nav: { page: Page; icon: typeof Package; index: string }[] = [
  { page: 'overview', icon: LayoutDashboard, index: '01' }, { page: 'materials', icon: Package, index: '02' },
  { page: 'movements', icon: Activity, index: '03' }, { page: 'stockCount', icon: ClipboardCheck, index: '04' },
  { page: 'fields', icon: Layers3, index: '05' }, { page: 'settings', icon: Settings, index: '06' },
]

export default function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage)
  const t = useCallback<Translate>((key) => messages[language][key], [language])
  const [online, setOnline] = useState(navigator.onLine)
  const [mode, setMode] = useState<Mode>(null)
  const [session, setSession] = useState<GoogleSession | null>(null)
  const [repo, setRepo] = useState<InventoryRepository | null>(null)
  const [workbook, setWorkbook] = useState<WorkbookRef | null>(null)
  const [accountId, setAccountId] = useState('')
  const [email, setEmail] = useState('')
  const [identity, setIdentity] = useState<SubultechSession | null>(null)
  const [appAccess, setAppAccess] = useState<ApplicationAccess | null>(null)
  const identityRun = useRef(0)
  const [data, setData] = useState<WarehouseData>(emptyData)
  const [snapshots, setSnapshots] = useState<CachedSnapshot[]>([])
  const [workbooks, setWorkbooks] = useState<WorkbookRef[] | null>(null)
  const [restoring, setRestoring] = useState(() => !!loadIdentity())
  const [workbookName, setWorkbookName] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [needsFreshLoad, setNeedsFreshLoad] = useState(false)
  const [pendingCheck, setPendingCheck] = useState<PendingCheck | null>(null)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [writeDetail, setWriteDetail] = useState<string | null>(null)
  const [schemaIssue, setSchemaIssue] = useState<SchemaIssue | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [dialog, setDialog] = useState<Dialog>(null)
  const closeDialog = useCallback(() => setDialog(null), [])
  const [itemSearch, setItemSearch] = useState('')
  const [category, setCategory] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [movementSearch, setMovementSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [hiddenFields, setHiddenFields] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('rufoof-hidden-fields') || '[]')
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
    } catch { return [] }
  })
  const [countItem, setCountItem] = useState('')
  const [countValue, setCountValue] = useState('')
  const [countBaseline, setCountBaseline] = useState<number | null>(null)
  const [countReview, setCountReview] = useState<{ baseline: number; current: number; counted: number } | null>(null)

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    document.title = `${messages[language].appName} | ${messages[language].ledger}`
    try { localStorage.setItem('rufoof-language', language) } catch { /* The selection remains active in memory. */ }
  }, [language])
  useEffect(() => {
    try { localStorage.setItem('rufoof-hidden-fields', JSON.stringify(hiddenFields)) } catch { /* The selection remains active in memory. */ }
  }, [hiddenFields])
  useEffect(() => {
    if (!dialog) return
    setWriteDetail(null)
    setError((current) => current === 'fieldTypeBlocked' ? null : current)
  }, [dialog])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (!session || mode !== 'google') return
    const check = () => { if (Date.now() >= session.expiresAt) setAuthRequired(true) }
    check()
    const timer = window.setInterval(check, 30000)
    return () => window.clearInterval(timer)
  }, [session, mode])
  const loadSnapshots = useCallback(async () => {
    try { setSnapshots(await listSnapshots()) } catch { setError('cacheError') }
  }, [])
  useEffect(() => { void loadSnapshots() }, [loadSnapshots])
  const toggleLanguage = () => setLanguage((value) => value === 'en' ? 'ar' : 'en')
  const resetWorkspaceView = () => { setPage('overview'); setItemSearch(''); setCategory(''); setStockFilter(''); setMovementSearch(''); setKindFilter(''); setFromDate(''); setToDate(''); setCountItem(''); setCountValue(''); setCountBaseline(null); setCountReview(null) }
  const start = () => { if (lock.current) return false; lock.current = true; setBusy(true); setError(null); setNotice(null); setWriteDetail(null); return true }
  const finish = () => { lock.current = false; setBusy(false) }
  const reportLoadFailure = (cause: unknown) => {
    if (unauthorized(cause)) setAuthRequired(true)
    setSchemaIssue(cause instanceof WorkbookDataError ? cause.issues[0] ?? null : null)
    if (cause instanceof WorkbookDataError || cause instanceof WorkbookDiscoveryError) setNeedsFreshLoad(true)
    setError(loadFailure(cause))
  }
  const storeSnapshot = async (currentSession: GoogleSession | null, ref: WorkbookRef, currentData: WarehouseData) => {
    if (!currentSession) return
    try { await saveSnapshot({ accountId: currentSession.accountId, email: currentSession.email, workbook: ref, data: currentData, savedAt: new Date().toISOString() }) }
    catch { setNotice('cacheWarning') }
  }
  // SubulTech issues the app session; the plan check is advisory and never blocks the ledger.
  const verifyAccess = async (current: SubultechSession, run: number) => {
    const apply = (access: ApplicationAccess | null) => { if (identityRun.current === run) setAppAccess(access) }
    try {
      const access = await fetchApplicationAccess(current)
      apply(access)
    } catch (cause) {
      if (!(cause instanceof SubultechError) || cause.status !== 401) { apply(null); return }
      try {
        const renewed = await refreshSubultechSession(current)
        if (identityRun.current !== run) return
        setIdentity(renewed)
        apply(await fetchApplicationAccess(renewed))
      } catch { apply(null) }
    }
  }
  const connect = async (reconnect = false) => {
    if (!navigator.onLine) { setError('offlineError'); return }
    if (!start()) return
    setAppAccess(null)
    try {
      beginGoogleAuthorization()
      // The browser navigates to Google and returns through the callback effect below.
    } catch (cause) {
      if (cause instanceof SubultechError) {
        setError(cause.code === 'SUBULTECH_NOT_CONFIGURED' ? 'subultechConfigError'
          : cause.code === 'GOOGLE_TOKEN_INVALID' || cause.code === 'GOOGLE_PROFILE_INVALID' ? 'subultechGoogleError'
          : cause.code === 'APPLICATION_INVALID' ? 'subultechAppError'
          : cause.code === 'SUBULTECH_NETWORK' ? 'subultechNetworkError'
          : 'subultechAuthError')
        return
      }
      const message = cause instanceof Error ? cause.message : ''
      setError(message.includes('VITE_GOOGLE_CLIENT_ID') ? 'googleConfigError' : message.includes('user gesture') ? 'googleGestureError' : 'authError')
    } finally { finish() }
  }
  useEffect(() => {
    let cancelled = false
    const callback = async () => {
      try {
        const result = consumeGoogleAuthorizationCallback()
        if (!result) return
        setBusy(true)
        const identity = await exchangeGoogleAuthorizationCode(result.code, result.redirectUri)
        // The callback effect can be mounted twice by React StrictMode in dev.
        // Once the one-time authorization code has been exchanged successfully,
        // persist the SubulTech session and leave the callback route even if the
        // first effect instance has already been cleaned up.
        saveIdentity(identity)
        window.location.replace('/')
      } catch (cause) {
        if (cancelled) return
        // Keep the stable API code visible during OAuth diagnostics without logging tokens.
        if (cause instanceof SubultechError) console.error('OAuth callback failed:', cause.code, cause.detail || '')
        setError(cause instanceof SubultechError ? 'subultechAuthError' : 'authError')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void callback()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const savedIdentity = loadIdentity()
    if (!savedIdentity) return
    let cancelled = false
    const restore = async () => {
      try {
        const renewedIdentity = await refreshSubultechSession({ accessToken: '', refreshToken: savedIdentity.refreshToken, user: savedIdentity.user })
        if (cancelled) return
        setIdentity(renewedIdentity)
        if (isRememberEnabled()) saveIdentity(renewedIdentity)
        let googleSession: GoogleSession
        try {
          // Prefer the server-side OAuth refresh token. This survives browser
          // restarts and does not depend on Google's silent-popup heuristics.
          googleSession = await refreshGoogleAccessToken(renewedIdentity)
        } catch {
          // Compatibility fallback for accounts created before OAuth refresh
          // tokens were stored by Identity.
          googleSession = await authorizeGoogleSilently(renewedIdentity.user.email)
        }
        const nextIdentity = await exchangeGoogleToken(googleSession.accessToken)
        const nextRepo = googleRepository(googleSession)
        const found = await nextRepo.listWorkbooks()
        const saved = await listSavedWorkbooks(nextIdentity).catch(() => [])
        const byId = new Map(found.map((item) => [item.id, item]))
        const remembered = saved.map((item) => byId.get(item.workbook_id)).filter((item): item is WorkbookRef => !!item)
        const rememberedIds = new Set(remembered.map((item) => item.id))
        const ordered = [...remembered, ...found.filter((item) => !rememberedIds.has(item.id))]
        if (cancelled) return
        setIdentity(nextIdentity); setSession(googleSession); setRepo(nextRepo); setAccountId(googleSession.accountId); setEmail(googleSession.email); setMode('google'); setAuthRequired(false)
        const last = loadLastWorkbook()
        const selected = last && last.accountId === googleSession.accountId ? byId.get(last.workbook.id) : undefined
        if (selected) {
          const loaded = await nextRepo.loadWorkbook(selected.id)
          if (cancelled) return
          setWorkbook(selected); setData(loaded); setWorkbooks(null); await storeSnapshot(googleSession, selected, loaded)
        } else setWorkbooks(ordered)
      } catch (cause) {
        if (!cancelled) {
          if (cause instanceof SubultechError) console.error('Session restore failed:', cause.code, cause.detail || '')
          setMode(null); setWorkbooks(null)
          setError(cause instanceof SubultechError ? 'subultechAuthError' : 'authError')
        }
      } finally { if (!cancelled) setRestoring(false) }
    }
    void restore()
    return () => { cancelled = true }
  }, [])
  const startDemo = async () => {
    if (!start()) return
    try {
      const demoRepo = createDemoRepository()
      const found = await demoRepo.listWorkbooks()
      if (!found[0] && !navigator.onLine) { setError('offlineError'); return }
      const ref = found[0] ?? await demoRepo.createWorkbook('Demo')
      const loaded = await demoRepo.loadWorkbook(ref.id)
      identityRun.current++
      setRepo(demoRepo); setSession(null); setIdentity(null); setAppAccess(null); setAccountId(''); setEmail(''); setMode('demo'); setWorkbook(ref); setWorkbooks(null); setData(loaded); resetWorkspaceView(); setNeedsRefresh(false); setNeedsFreshLoad(false); setPendingCheck(null); setAuthRequired(false); setSchemaIssue(null)
    } catch { setError('loadError') } finally { finish() }
  }
  const openWorkbook = async (ref: WorkbookRef) => {
    if (!repo || !navigator.onLine) { setError('offlineError'); return }
    if (!start()) return
    try {
      const loaded = await repo.loadWorkbook(ref.id)
      setWorkbook(ref); setData(loaded); setWorkbooks(null); resetWorkspaceView(); setNeedsRefresh(false); setNeedsFreshLoad(false); setPendingCheck(null); setSchemaIssue(null)
      if (mode === 'google' && session) saveLastWorkbook({ accountId: session.accountId, email: session.email, workbook: ref })
      await storeSnapshot(session, ref, loaded)
      if (identity) await saveWorkbookReference(identity, ref, true).catch(() => undefined)
    } catch (cause) { reportLoadFailure(cause) } finally { finish() }
  }
  const createWorkbook = async (event: FormEvent) => {
    event.preventDefault()
    if (!repo || !workbookName.trim() || !navigator.onLine) { if (!navigator.onLine) setError('offlineError'); return }
    if (!start()) return
    try {
      const ref = await repo.createWorkbook(workbookName.trim())
      const loaded = await repo.loadWorkbook(ref.id)
      setWorkbook(ref); setData(loaded); setWorkbooks(null); setWorkbookName(''); resetWorkspaceView(); setNeedsRefresh(false); setNeedsFreshLoad(false); setPendingCheck(null); setSchemaIssue(null)
      if (mode === 'google' && session) saveLastWorkbook({ accountId: session.accountId, email: session.email, workbook: ref })
      await storeSnapshot(session, ref, loaded)
      if (identity) await saveWorkbookReference(identity, ref, true).catch(() => undefined)
    } catch (cause) { if (unauthorized(cause)) setAuthRequired(true); setError('writeError'); setNeedsRefresh(true) } finally { finish() }
  }
  const openSnapshot = (snapshot: CachedSnapshot) => {
    identityRun.current++
    setMode('cache'); setSession(null); setIdentity(null); setAppAccess(null); setRepo(null); setAccountId(snapshot.accountId); setEmail(snapshot.email); setWorkbook(snapshot.workbook); setData(snapshot.data); resetWorkspaceView(); setWorkbooks(null); setAuthRequired(false); setNeedsRefresh(false); setNeedsFreshLoad(false); setPendingCheck(null); setSchemaIssue(null); setError(null); setNotice(null)
  }
  const refresh = async () => {
    if (!repo || !workbook || !navigator.onLine) { setError(!navigator.onLine ? 'offlineError' : 'sessionError'); return }
    if (mode === 'google' && (!session || authRequired || Date.now() >= session.expiresAt)) { setAuthRequired(true); setError('sessionError'); return }
    if (!start()) return
    try {
      const loaded = await repo.loadWorkbook(workbook.id)
      setData(loaded); setNeedsRefresh(false); setNeedsFreshLoad(false); setSchemaIssue(null); setNotice('refreshed')
      if (mode === 'google') await storeSnapshot(session, workbook, loaded)
    } catch (cause) { reportLoadFailure(cause) } finally { finish() }
  }
  const writable = online && mode !== 'cache' && !!repo && !!workbook && !busy && !authRequired && !needsRefresh && !needsFreshLoad && !pendingCheck && (mode !== 'google' || (!!session && Date.now() < session.expiresAt))
  const write = async (operation: (repository: InventoryRepository, workbookId: string) => Promise<void>, optimistic: (current: WarehouseData) => WarehouseData, success: MessageKey, check: PendingCheck): Promise<boolean> => {
    if (!navigator.onLine) { setError('offlineError'); return false }
    if (!repo || !workbook || mode === 'cache' || (mode === 'google' && (!session || authRequired || Date.now() >= session.expiresAt))) { setAuthRequired(true); setError('sessionError'); return false }
    if (needsRefresh || needsFreshLoad || pendingCheck || !start()) return false
    let confirmed = false
    try {
      await operation(repo, workbook.id)
      confirmed = true
      setData(optimistic)
      setNotice(success)
      try {
        const loaded = await repo.loadWorkbook(workbook.id)
        setData(loaded)
        if (mode === 'google') await storeSnapshot(session, workbook, loaded)
      } catch (cause) {
        reportLoadFailure(cause)
      }
      return true
    } catch (cause) {
      if (unauthorized(cause)) setAuthRequired(true)
      if (cause instanceof FieldValueError) { setWriteDetail(cause.rows.join(', ')); setError('fieldTypeBlocked'); return confirmed }
      setNeedsRefresh(true); setPendingCheck(check); setError('writeError')
      return confirmed
    } finally { finish() }
  }
  const saveItem = (item: Item) => write((repository, id) => repository.saveItem(id, item, data.requiredItemFields ?? DEFAULT_REQUIRED_ITEM_FIELDS), (current) => ({ ...current, items: current.items.some((existing) => existing.id === item.id) ? current.items.map((existing) => existing.id === item.id ? item : existing) : [...current.items, item] }), 'updated', { target: 'item', id: item.id })
  const saveMovement = (movement: Movement) => write((repository, id) => repository.appendMovements(id, [movement]), (current) => ({ ...current, movements: [...current.movements, movement] }), 'movementSaved', { target: 'movement', id: movement.id })
  const saveField = (field: CustomField) => write((repository, id) => repository.addField(id, field), (current) => ({ ...current, fields: [...current.fields, field] }), 'fieldAdded', { target: 'field', id: field.id })
  const updateField = (field: CustomField) => write((repository, id) => repository.updateField(id, field), (current) => ({ ...current, fields: current.fields.map((existing) => existing.id === field.id ? { ...existing, type: field.type } : existing) }), 'fieldUpdated', { target: 'field', id: field.id })
  const saveRequirements = (required: ItemRequirement[]) => write((repository, id) => repository.saveItemRequirements(id, required, data.requiredItemFields ?? DEFAULT_REQUIRED_ITEM_FIELDS), (current) => ({ ...current, requiredItemFields: [...required] }), 'requiredFieldsSaved', { target: 'requirements', fields: [...required] })
  const repairSchema = async () => {
    if (!schemaIssue || !isRepairableIssue(schemaIssue) || !repo?.repairMissingColumn || !workbook) return
    if (!navigator.onLine) { setError('offlineError'); return }
    if (mode === 'google' && (!session || authRequired || Date.now() >= session.expiresAt)) { setAuthRequired(true); setError('sessionError'); return }
    if (!start()) return
    try {
      await repo.repairMissingColumn(workbook.id, schemaIssue.target, schemaIssue.coreId)
      const loaded = await repo.loadWorkbook(workbook.id)
      setData(loaded); setSchemaIssue(null); setNeedsRefresh(false); setNeedsFreshLoad(false); setNotice('schemaRepaired')
      if (mode === 'google') await storeSnapshot(session, workbook, loaded)
    } catch (cause) {
      if (unauthorized(cause)) { setAuthRequired(true); setError('sessionError'); return }
      if (cause instanceof WorkbookDataError) { setSchemaIssue(cause.issues[0] ?? null); setError('workbookDataError'); setNeedsFreshLoad(true); return }
      setNeedsFreshLoad(true); setError('writeError')
    } finally { finish() }
  }
  const signOut = async () => {
    if (!start()) return
    try {
      identityRun.current++
      clearIdentity()
      if (identity) void logoutSubultechSession(identity).catch(() => { /* Local sign-out continues if the session already expired. */ })
      if (accountId) await clearSnapshots(accountId)
      setMode(null); setSession(null); setIdentity(null); setAppAccess(null); setRepo(null); setWorkbook(null); setWorkbooks(null); setData(emptyData); setAccountId(''); setEmail(''); setDialog(null); setAuthRequired(false); setNeedsRefresh(false); setNeedsFreshLoad(false); setPendingCheck(null); setSchemaIssue(null); resetWorkspaceView()
      await loadSnapshots()
    } catch { setError('signOutError') } finally { finish() }
  }
  const deleteAccount = async () => {
    if (mode !== 'google' || !identity || !window.confirm(language === 'ar' ? 'سيتم حذف حسابك وبيانات SubulTech ومراجع ملفاتك. لن تُحذف ملفات Google Sheets. هل تريد المتابعة؟' : 'This deletes your SubulTech account and saved workbook references. Google Sheets files will not be deleted. Continue?')) return
    if (!start()) return
    try {
      await deleteSubultechAccount(identity)
      clearSession()
      identityRun.current++
      setMode(null); setSession(null); setIdentity(null); setAppAccess(null); setRepo(null); setWorkbook(null); setWorkbooks(null); setData(emptyData); setAccountId(''); setEmail(''); setError(null)
      await loadSnapshots()
    } catch (cause) {
      setError(cause instanceof SubultechError && cause.status === 401 ? 'sessionError' : 'signOutError')
    } finally { finish() }
  }
  const changeLedger = async () => {
    if (!repo || !navigator.onLine) { setError('offlineError'); return }
    if (!start()) return
    try { setWorkbooks(await repo.listWorkbooks()); setWorkbook(null) } catch (cause) { if (unauthorized(cause)) setAuthRequired(true); setError(loadFailure(cause)) } finally { finish() }
  }
  const selectCountItem = (id: string) => {
    setCountItem(id); setCountValue(''); setCountReview(null)
    const item = data.items.find((entry) => entry.id === id)
    setCountBaseline(item ? getBalance(item, data.movements) : null)
  }
  const checkCount = async (confirm = false) => {
    const counted = Number(countValue)
    if (!countItem || countValue === '' || !Number.isFinite(counted) || counted < 0 || countBaseline === null) { setError(!countItem ? 'selectError' : 'invalidNumber'); return }
    if (!writable || !repo || !workbook) { setError(!navigator.onLine ? 'offlineError' : 'sessionError'); return }
    if (!start()) return
    try {
      const latest = await repo.loadWorkbook(workbook.id)
      setData(latest)
      if (mode === 'google') await storeSnapshot(session, workbook, latest)
      const item = latest.items.find((entry) => entry.id === countItem)
      if (!item) { setError('loadError'); return }
      const balance = getBalance(item, latest.movements)
      const expected = confirm ? countReview?.current : countBaseline
      if (balance !== expected) { setCountReview({ baseline: countBaseline, current: balance, counted }); return }
      const delta = counted - balance
      if (delta === 0) { setCountReview(null); setCountBaseline(balance); setNotice('countNoChange'); return }
      if (!navigator.onLine) { setError('offlineError'); return }
      if (mode === 'google' && (!session || Date.now() >= session.expiresAt)) { setAuthRequired(true); setError('sessionError'); return }
      const movement: Movement = { id: crypto.randomUUID(), itemId: item.id, date: today(), kind: 'adjustment', quantity: delta, party: '', document: '', notes: t('stockCount'), custom: {} }
      try {
        await repo.appendMovements(workbook.id, [movement])
      } catch (cause) { if (unauthorized(cause)) setAuthRequired(true); setNeedsRefresh(true); setPendingCheck({ target: 'movement', id: movement.id }); setError('writeError'); return }
      setData({ ...latest, movements: [...latest.movements, movement] }); setCountReview(null); setCountValue(''); setCountBaseline(counted); setNotice('countSaved')
      try { const saved = await repo.loadWorkbook(workbook.id); setData(saved); if (mode === 'google') await storeSnapshot(session, workbook, saved) }
      catch (cause) { reportLoadFailure(cause) }
    } catch (cause) { reportLoadFailure(cause) } finally { finish() }
  }
  const exportCSV = (target: FieldTarget) => {
    const fields = data.fields.filter((field) => field.target === target)
    const records = target === 'items' ? data.items : data.movements
    const unknown = Array.from(new Set(records.flatMap((record) => Object.keys(record.custom)))).filter((key) => !fields.some((field) => field.id === key))
    const customKeys = [...fields.map((field) => field.id), ...unknown]
    const customHeaders = [...fields.map((field) => field.name), ...unknown]
    const headers = target === 'items' ? [t('code'), t('name'), t('unit'), t('openingBalance'), t('currentBalance'), t('category'), t('minimumStock'), t('location'), t('notes'), ...customHeaders] : [t('date'), t('material'), t('code'), t('type'), t('quantity'), t('party'), t('document'), t('notes'), ...customHeaders]
    const rows = target === 'items' ? data.items.map((item) => [item.code, item.name, item.unit, item.openingBalance, getBalance(item, data.movements), item.category, item.minimumStock ?? '', item.location, item.notes, ...customKeys.map((key) => item.custom[key] ?? '')]) : data.movements.map((movement) => { const item = data.items.find((entry) => entry.id === movement.itemId); return [movement.date, item?.name ?? movement.itemId, item?.code ?? '', t(movement.kind), movement.quantity, movement.party, movement.document, movement.notes, ...customKeys.map((key) => movement.custom[key] ?? '')] })
    try {
      const url = URL.createObjectURL(new Blob([toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = `rufoof-${target}-${today()}.csv`; link.click(); URL.revokeObjectURL(url)
    } catch { setError('genericError') }
  }
  const exportExcel = async () => {
    try {
      await downloadWorkbook(`rufoof-${today()}.xlsx`, buildExportSheets(data, {
        code: t('code'), name: t('name'), unit: t('unit'), openingBalance: t('openingBalance'), currentBalance: t('currentBalance'),
        category: t('category'), minimumStock: t('minimumStock'), location: t('location'), notes: t('notes'), date: t('date'), material: t('material'),
        type: t('type'), quantity: t('quantity'), party: t('party'), document: t('document'), sheetItems: t('materials'), sheetMovements: t('movements'),
        kinds: { in: t('in'), out: t('out'), adjustment: t('adjustment') },
      }), language === 'ar')
      setNotice('excelExported')
    } catch { setError('genericError') }
  }
  const importItems = async (items: Item[]) => {
    const saved = await write(
      (repository, id) => repository.appendItems(id, items, data.requiredItemFields ?? DEFAULT_REQUIRED_ITEM_FIELDS),
      (current) => ({ ...current, items: [...current.items, ...items] }),
      'imported',
      { target: 'items', items },
    )
    if (saved) setDialog(null)
    return saved
  }

  const requiredItemFields = data.requiredItemFields ?? DEFAULT_REQUIRED_ITEM_FIELDS
  const existingCodes = useMemo(() => data.items.map((item) => item.code), [data.items])
  const categories = useMemo(() => Array.from(new Set(data.items.map((item) => item.category).filter(Boolean))).sort(), [data.items])
  const filteredItems = data.items.filter((item) => {
    const query = itemSearch.toLocaleLowerCase().trim()
    return (!query || [item.name, item.code, item.category, item.location, ...Object.values(item.custom)].some((value) => value.toLocaleLowerCase().includes(query))) && (!category || item.category === category) && (!stockFilter || (stockFilter === 'low' ? isLow(item, data) : !isLow(item, data)))
  })
  const sortedMovements = [...data.movements].sort((a, b) => b.date.localeCompare(a.date))
  const filteredMovements = sortedMovements.filter((movement) => {
    const item = data.items.find((entry) => entry.id === movement.itemId)
    const query = movementSearch.toLocaleLowerCase().trim()
    return (!kindFilter || movement.kind === kindFilter) && (!fromDate || movement.date.slice(0, 10) >= fromDate) && (!toDate || movement.date.slice(0, 10) <= toDate) && (!query || [item?.name, item?.code, movement.date, movement.party, movement.document, movement.notes, ...Object.values(movement.custom)].some((value) => value?.toLocaleLowerCase().includes(query)))
  })
  const lowItems = data.items.filter((item) => isLow(item, data))
  const detailItem = dialog?.kind === 'detail' ? data.items.find((item) => item.id === dialog.itemId) : undefined
  const checkedItem = pendingCheck?.target === 'item' ? data.items.find((item) => item.id === pendingCheck.id) : undefined
  const checkedMovement = pendingCheck?.target === 'movement' ? data.movements.find((movement) => movement.id === pendingCheck.id) : undefined
  const checkedField = pendingCheck?.target === 'field' ? data.fields.find((field) => field.id === pendingCheck.id) : undefined
  const checkLines: [string, string][] = checkedItem ? [
    [t('code'), checkedItem.code], [t('name'), checkedItem.name], [t('unit'), checkedItem.unit], [t('openingBalance'), String(checkedItem.openingBalance)],
    [t('category'), checkedItem.category], [t('minimumStock'), checkedItem.minimumStock === null ? '—' : String(checkedItem.minimumStock)],
    [t('location'), checkedItem.location], [t('notes'), checkedItem.notes],
    ...Object.entries(checkedItem.custom).map(([key, value]): [string, string] => [data.fields.find((field) => field.target === 'items' && field.id === key)?.name || key, value]),
  ] : checkedMovement ? [
    [t('material'), data.items.find((item) => item.id === checkedMovement.itemId)?.name || checkedMovement.itemId], [t('date'), checkedMovement.date],
    [t('type'), t(checkedMovement.kind)], [t('quantity'), String(checkedMovement.quantity)], [t('party'), checkedMovement.party],
    [t('document'), checkedMovement.document], [t('notes'), checkedMovement.notes],
    ...Object.entries(checkedMovement.custom).map(([key, value]): [string, string] => [data.fields.find((field) => field.target === 'movements' && field.id === key)?.name || key, value]),
  ] : checkedField ? [[t('fieldName'), checkedField.name], [t('fieldType'), t(checkedField.type === 'date' ? 'dateField' : checkedField.type)], [t('fieldTarget'), t(checkedField.target === 'items' ? 'materials' : 'movements')]] : []
  const loadedItemsById = new Map(data.items.map((item) => [item.id, item]))
  const importStatus = (expected: Item): MessageKey => {
    const actual = loadedItemsById.get(expected.id)
    if (!actual) return 'importNotFound'
    const sameCore = (['code', 'name', 'unit', 'openingBalance', 'category', 'minimumStock', 'location', 'notes'] as const).every((key) => expected[key] === actual[key])
    const sameCustom = Object.entries(expected.custom).every(([key, value]) => (actual.custom[key] ?? '') === value)
    return sameCore && sameCustom ? 'importFound' : 'importConflict'
  }
  const verificationPanel = pendingCheck && !needsRefresh && !authRequired ? <div className="verification-panel" role="status">{pendingCheck.target === 'items' ? <><strong>{t('schemaTitle')}</strong><p>{t('importCheck')}</p><dl className="import-verification">{pendingCheck.items.map((item) => <div key={item.id}><dt dir="auto">{item.code || item.name} · {item.id}</dt><dd>{t(importStatus(item))}</dd></div>)}</dl></> : pendingCheck.target === 'requirements' ? <><strong>{t('requiredFieldsTitle')}</strong><p>{t('requiredFieldsCheck')}</p><dl><div><dt>{t('requiredFieldsRequested')}</dt><dd>{pendingCheck.fields.map((field) => requirementLabel(field, data.fields, t)).join('، ')}</dd></div><div><dt>{t('requiredFieldsCurrent')}</dt><dd>{requiredItemFields.map((field) => requirementLabel(field, data.fields, t)).join('، ')}</dd></div></dl></> : <><strong>{t(checkedItem || checkedMovement || checkedField ? 'recordFound' : 'recordNotFound')}</strong><p>{t('reviewBeforeResume')}</p><dl><div><dt>{t('recordId')}</dt><dd>{pendingCheck.id}</dd></div>{checkLines.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl></>}<button type="button" className="button secondary" onClick={() => setPendingCheck(null)}>{t('resumeWrites')}</button></div> : null
  const modalNotice = <>{verificationPanel}{error && <div className="message error" role="alert"><AlertCircle size={17} /><span>{t(error)}{writeDetail && <b dir="ltr"> ({writeDetail})</b>}</span></div>}{!online && <div className="message warning"><CloudOff size={17} /><span>{t('offlineBanner')}</span></div>}{(authRequired || mode === 'cache') && <div className="message warning"><AlertCircle size={17} /><span>{t('expiredBanner')}</span><button type="button" className="text-button" disabled={!online || busy} onClick={() => void connect(true)}>{t('reconnect')}</button></div>}{needsFreshLoad && !needsRefresh && <div className="message warning"><RefreshCw size={17} /><span>{t('refreshCopy')}</span><button type="button" className="text-button" disabled={!online || busy || authRequired} onClick={() => void refresh()}>{t('refresh')}</button></div>}{needsRefresh && <div className="message warning"><AlertCircle size={17} /><span>{t('uncertainBanner')}</span><button type="button" className="text-button" disabled={!online || busy || authRequired || mode === 'cache'} onClick={() => void refresh()}>{t('refresh')}</button></div>}</>
  const languageButton = <button className="language-button" onClick={toggleLanguage} aria-label={t('languageToggle')}><Languages size={17} /><span>{language === 'en' ? 'العربية' : 'English'}</span></button>


  if (!workbook) return <div className="welcome-shell"><header className="welcome-header"><Brand t={t} />{languageButton}</header><main className="welcome-main"><div className="welcome-copy"><span className="eyebrow"><span className="eyebrow-dot" />{t('welcomeEyebrow')}</span><h1>{t('welcomeTitle')}</h1><p>{t('welcomeText')}</p><div className="welcome-register" aria-hidden="true"><div className="register-index"><span>R</span><span>01</span><span>02</span><span>03</span></div><div className="register-paper"><div className="register-paper-top"><span>RUFOOF / {t('register')}</span><BookOpen size={18} /></div><div className="paper-row"><span>01</span><i /><b /></div><div className="paper-row"><span>02</span><i /><b /></div><div className="paper-row"><span>03</span><i /><b /></div><div className="paper-row"><span>04</span><i /><b /></div><div className="paper-footer">{t('appTagline')} <span>✳</span></div></div></div></div><div className="welcome-card"><span className="card-number">{workbooks ? '02' : '01'} / RUFOOF</span>{restoring ? <div className="restore-state" role="status" aria-live="polite"><div className="restore-orbit" aria-hidden="true"><span /><span /><span /></div><div><h2>{t('restoring')}</h2><p>{t('restoringText')}</p></div><div className="restore-skeleton" aria-hidden="true"><i /><i /><i /></div></div> : workbooks ? <><h2>{t('chooseWorkbook')}</h2><p>{t('chooseWorkbookText')}</p>{error && <div className="message error" role="alert"><AlertCircle size={17} />{t(error)}</div>}{authRequired && <button className="button secondary full" disabled={busy || !online} onClick={() => void connect()}>{t('reconnect')}</button>}<div className="workbook-list">{workbooks.length ? workbooks.map((ref) => <button className="workbook-option" key={ref.id} disabled={busy || !online} onClick={() => void openWorkbook(ref)}><span className="option-icon"><FileSpreadsheet size={19} /></span><strong>{ref.name}</strong><ChevronRight size={18} /></button>) : <p className="muted">{t('noWorkbooks')}</p>}</div><form onSubmit={(e) => void createWorkbook(e)} className="create-ledger"><FormField label={t('workbookName')}><input required value={workbookName} placeholder={t('workbookPlaceholder')} onChange={(e) => setWorkbookName(e.target.value)} /></FormField><button className="button primary" disabled={busy || !online || needsRefresh}>{busy ? t('loading') : t('create')}</button></form>{needsRefresh && <p className="form-hint">{t('uncertainBanner')} <button className="text-button" onClick={() => void connect()}>{t('reconnect')}</button></p>}<button className="back-link" onClick={() => { identityRun.current++; setWorkbooks(null); setMode(null); setMode(null); setRepo(null); setSession(null); setIdentity(null); setAppAccess(null); setError(null) }}>{t('back')}</button></> : <><span className="eyebrow">{t('ledger')}</span><h2>{t('googleTitle')}</h2><p>{t('googleText')}</p>{error && <div className="message error" role="alert"><AlertCircle size={17} />{t(error)}</div>}<button className="button primary full google-button" disabled={busy || !online} onClick={() => void connect()}><span className="google-g" aria-hidden="true">G</span>{busy ? t('connecting') : t('googleButton')}<ArrowRight className="button-arrow" size={17} /></button><div className="or-divider"><span>{t('or')}</span></div><button className="button secondary full" disabled={busy} onClick={() => void startDemo()}><BookOpen size={17} />{t('demoButton')}</button><p className="small-note">{t('demoNote')}</p><div className="privacy-note"><CloudOff size={17} /><span>{t('privacyNote')}</span></div>{snapshots.length > 0 && <div className="snapshot-list"><h3>{t('cachedCopies')}</h3><p>{t('cachedHint')}</p>{snapshots.map((snapshot) => <button key={`${snapshot.accountId}-${snapshot.workbook.id}`} className="snapshot-option" onClick={() => openSnapshot(snapshot)}><span><strong>{snapshot.workbook.name}</strong><small>{snapshot.email} · {t('saved')} {new Date(snapshot.savedAt).toLocaleString(language)}</small></span><span>{t('openCopy')} <ChevronRight size={15} /></span></button>)}</div>}</>}</div></main><footer className="welcome-footer"><span>RUFOOF / {t('ledger')}</span><span>{t('builtWithAI')}</span></footer></div>
  return <div className="app-shell"><aside className="sidebar"><Brand t={t} /><div className="sidebar-label">{t('workspace')}</div><nav className="side-nav" aria-label={t('mainNavigation')}>{nav.map(({ page: target, icon: Icon, index }) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)} aria-current={page === target ? 'page' : undefined}><Icon size={19} /><span>{t(target)}</span><small>{index}</small></button>)}</nav><div className="sidebar-bottom"><div className="sidebar-ledger"><span className="sidebar-ledger-icon"><BookOpen size={17} /></span><div><small>{t('workbook')}</small><strong>{workbook.name}</strong></div></div><div className="sidebar-foot">RUFOOF <span>•</span> {t('ledger')}</div></div></aside><div className="app-main"><header className="topbar"><div className="breadcrumb"><span>{t('ledger')}</span><ChevronRight size={14} /><strong>{t(page)}</strong></div><div className="topbar-actions"><span className={`connection ${online ? '' : 'is-offline'}`}><span />{!online ? t('offline') : mode === 'demo' ? t('demo') : mode === 'cache' ? t('readOnly') : t('online')}</span>{languageButton}<button className="avatar" onClick={() => setPage('settings')} aria-label={t('settings')}>{mode === 'demo' ? 'D' : (email[0] || 'R').toUpperCase()}</button></div></header><main className="content"><div className="content-inner">{(page === 'materials' || page === 'movements') && <div className="print-report-header"><strong>{t('appName')} · {workbook.name}</strong><span>{t(page)} · {today()}</span></div>}<div className="notices" aria-live="polite">{mode === 'demo' && <div className="message demo-message"><BookOpen size={17} /><span>{t('demoBanner')}</span></div>}{!online && <div className="message warning"><CloudOff size={17} /><span>{t('offlineBanner')}</span></div>}{mode === 'cache' && <div className="message warning"><CloudOff size={17} /><span>{t('cacheBanner')}</span><button className="text-button" disabled={!online || busy} onClick={() => void connect(true)}>{t('reconnect')}</button></div>}{needsFreshLoad && !needsRefresh && <div className="message warning"><RefreshCw size={17} /><span>{t('refreshCopy')}</span><button className="text-button" disabled={!online || busy || authRequired} onClick={() => void refresh()}>{t('refresh')}</button></div>}{authRequired && <div className="message warning"><AlertCircle size={17} /><span>{t('expiredBanner')}</span><button className="text-button" disabled={!online || busy} onClick={() => void connect(true)}>{t('reconnect')}</button></div>}{needsRefresh && <div className="message warning"><AlertCircle size={17} /><span>{t('uncertainBanner')}</span><button className="text-button" disabled={!online || busy || authRequired || mode === 'cache'} onClick={() => void refresh()}>{t('refresh')}</button></div>}{verificationPanel}{schemaIssue && <SchemaIssuePanel issue={schemaIssue} t={t} busy={busy} canRepair={mode === 'google' && !!repo?.repairMissingColumn && online && !authRequired} onRepair={() => void repairSchema()} onReload={() => void refresh()} />}{error && <div className="message error" role="alert"><AlertCircle size={17} /><span>{t(error)}{writeDetail && <b dir="ltr"> ({writeDetail})</b>}</span><button className="dismiss" onClick={() => setError(null)} aria-label={t('dismiss')}><X size={16} /></button></div>}{notice && <div className="message success"><Check size={17} /><span>{t(notice)}</span><button className="dismiss" onClick={() => setNotice(null)} aria-label={t('dismiss')}><X size={16} /></button></div>}</div>
  {page === 'overview' && <><div className="page-heading"><div><span className="eyebrow">{t('dashboardEyebrow')}</span><h1>{t('dashboardTitle')}</h1><p>{t('dashboardText')}</p></div><button className="button primary" disabled={!writable || !data.items.length} onClick={() => setDialog({ kind: 'movement' })}><Plus size={17} />{t('recordMovement')}</button></div><div className="summary-grid"><button className="summary-card" onClick={() => setPage('materials')}><span className="summary-icon"><Package size={20} /></span><span className="summary-label">{t('totalMaterials')}</span><strong>{numberText(data.items.length, language)}</strong><small>{t('allMaterials')} <ArrowRight size={14} /></small><span className="summary-index">01</span></button><button className="summary-card" onClick={() => setPage('movements')}><span className="summary-icon blue"><Activity size={20} /></span><span className="summary-label">{t('totalMovements')}</span><strong>{numberText(data.movements.length, language)}</strong><small>{t('allMovements')} <ArrowRight size={14} /></small><span className="summary-index">02</span></button><button className="summary-card attention-card" onClick={() => { setStockFilter('low'); setPage('materials') }}><span className="summary-icon amber"><AlertCircle size={20} /></span><span className="summary-label">{t('lowStock')}</span><strong>{numberText(lowItems.length, language)}</strong><small>{t('needsAttention')} <ArrowRight size={14} /></small><span className="summary-index">03</span></button></div><div className="section-heading"><div><span className="eyebrow">{t('register')}</span><h2>{t('materials')}</h2><p>{t('materialsText')}</p></div><button className="button text-action" onClick={() => setPage('materials')}>{t('viewAll')} <ArrowRight size={16} /></button></div><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('allMaterials')}</span><span>{numberText(data.items.length, language)} / {t('itemsShort')}</span></div>{data.items.length ? <MaterialsTable items={data.items} limit={5} data={data} hiddenFields={hiddenFields} t={t} language={language} onDetail={(id) => setDialog({ kind: 'detail', itemId: id })} /> : <Empty title={t('noMaterials')} text={t('noMaterialsText')} />}</div><div className="section-heading activity-heading"><div><span className="eyebrow">{t('ledger')}</span><h2>{t('recentActivity')}</h2></div><button className="button text-action" onClick={() => setPage('movements')}>{t('viewAll')} <ArrowRight size={16} /></button></div><div className="ledger-panel">{sortedMovements.length ? <MovementTable movements={sortedMovements} limit={5} data={data} hiddenFields={hiddenFields} t={t} language={language} /> : <Empty title={t('noMovements')} text={t('noMovementsText')} icon={<Activity size={21} />} />}</div></>}
  {page === 'materials' && <><div className="page-heading"><div><span className="eyebrow">{t('materialsEyebrow')}</span><h1>{t('materialsTitle')}</h1><p>{t('materialsText')}</p></div><div className="heading-actions"><button className="button secondary" onClick={() => window.print()}><Printer size={17} />{t('print')}</button><button className="button secondary" onClick={() => exportCSV('items')}><Download size={17} />{t('export')}</button><button className="button secondary" onClick={() => void exportExcel()} title={t('excelAllNote')}><FileSpreadsheet size={17} />{t('exportExcel')}</button><button className="button secondary" onClick={() => window.print()} title={t('pdfHint')}><Printer size={17} />{t('exportPdf')}</button><button className="button secondary" disabled={!writable} onClick={() => setDialog({ kind: 'import' })}><Upload size={17} />{t('importTitle')}</button><button className="button primary" disabled={!writable} onClick={() => setDialog({ kind: 'item' })}><Plus size={17} />{t('addMaterial')}</button></div></div><p className="form-hint pdf-help">{t('pdfHint')} {t('excelAllNote')}</p><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('register')}</span></div><div className="filters"><label className="search-input"><Search size={18} /><span className="sr-only">{t('search')}</span><input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder={t('searchMaterials')} /></label><label><span className="sr-only">{t('category')}</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t('allCategories')}</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="sr-only">{t('status')}</span><select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}><option value="">{t('allStatuses')}</option><option value="low">{t('lowStock')}</option><option value="healthy">{t('healthy')}</option></select></label></div>{data.items.length ? <MaterialsTable items={filteredItems} data={data} hiddenFields={hiddenFields} t={t} language={language} onDetail={(id) => setDialog({ kind: 'detail', itemId: id })} /> : <Empty title={data.items.length ? t('noResults') : t('noMaterials')} text={data.items.length ? t('noResultsText') : t('noMaterialsText')} />}</div></>}
  {page === 'movements' && <><div className="page-heading"><div><span className="eyebrow">{t('movementsEyebrow')}</span><h1>{t('movementsTitle')}</h1><p>{t('movementsText')}</p></div><div className="heading-actions"><button className="button secondary" onClick={() => window.print()}><Printer size={17} />{t('print')}</button><button className="button secondary" onClick={() => exportCSV('movements')}><Download size={17} />{t('export')}</button><button className="button secondary" onClick={() => void exportExcel()} title={t('excelAllNote')}><FileSpreadsheet size={17} />{t('exportExcel')}</button><button className="button secondary" onClick={() => window.print()} title={t('pdfHint')}><Printer size={17} />{t('exportPdf')}</button><button className="button primary" disabled={!writable || !data.items.length} onClick={() => setDialog({ kind: 'movement' })}><Plus size={17} />{t('recordMovement')}</button></div></div><p className="form-hint pdf-help">{t('pdfHint')} {t('excelAllNote')}</p><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('movements')}</span></div><div className="filters"><label className="search-input"><Search size={18} /><span className="sr-only">{t('search')}</span><input value={movementSearch} onChange={(e) => setMovementSearch(e.target.value)} placeholder={t('searchMovements')} /></label><label><span className="sr-only">{t('type')}</span><select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="">{t('allKinds')}</option><option value="in">{t('in')}</option><option value="out">{t('out')}</option><option value="adjustment">{t('adjustment')}</option></select></label><label className="filter-date"><span>{t('fromDate')}</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label><label className="filter-date"><span>{t('toDate')}</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label></div>{data.movements.length ? <MovementTable movements={filteredMovements} data={data} hiddenFields={hiddenFields} t={t} language={language} /> : <Empty title={data.movements.length ? t('noResults') : t('noMovements')} text={data.movements.length ? t('noResultsText') : t('noMovementsText')} icon={<Activity size={21} />} />}</div></>}
  {page === 'stockCount' && <><div className="page-heading"><div><span className="eyebrow">{t('countEyebrow')}</span><h1>{t('countTitle')}</h1><p>{t('countText')}</p></div></div><div className="count-layout"><div className="ledger-panel count-sheet"><div className="panel-bar"><span><span className="bar-dot" />{t('countPage')}</span><span>{t('page')} / 01</span></div><div className="count-body"><div className="count-instruction"><span className="large-icon"><ClipboardCheck size={24} /></span><div><h2>{t('stockCount')}</h2><p>{t('countHint')}</p></div></div><div className="form-grid"><FormField label={t('countMaterial')} wide><select value={countItem} onChange={(e) => selectCountItem(e.target.value)}><option value="">{t('selectMaterial')}</option>{data.items.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></FormField><FormField label={t('recordedBalance')}><input readOnly value={countBaseline === null ? '—' : numberText(countBaseline, language)} /></FormField><FormField label={t('countedBalance')}><input type="number" min="0" step="any" value={countValue} onChange={(e) => { setCountValue(e.target.value); setCountReview(null) }} /></FormField></div>{countReview && <div className="count-review" role="alert"><strong><AlertCircle size={18} />{t('countChanged')}</strong><p>{t('countChangedText')}</p><div><span>{t('previousBalance')} <b>{numberText(countReview.baseline, language)}</b></span><span>{t('latestBalance')} <b>{numberText(countReview.current, language)}</b></span><span>{t('adjustmentAmount')} <b>{numberText(countReview.counted - countReview.current, language)}</b></span></div></div>}<button className="button primary count-submit" disabled={!writable || !countItem || countValue === ''} onClick={() => void checkCount(!!countReview)}>{busy ? t('saving') : countReview ? t('confirmCount') : t('reviewCount')} <ArrowRight size={16} /></button></div></div><div className="count-aside"><span className="aside-number">01 / 01</span><BookOpen size={21} /><h3>{t('ledger')}</h3><p>{t('countConcurrency')}</p></div></div></>}
  {page === 'fields' && <><div className="page-heading"><div><span className="eyebrow">{t('fieldsEyebrow')}</span><h1>{t('fieldsTitle')}</h1><p>{t('fieldsText')}</p></div><button className="button primary" disabled={!writable} onClick={() => setDialog({ kind: 'field' })}><Plus size={17} />{t('addField')}</button></div><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('fieldPage')}</span></div>{data.fields.length ? <FieldsTable fields={data.fields} hiddenFields={hiddenFields} setHiddenFields={setHiddenFields} writable={writable} t={t} language={language} onEdit={(field) => setDialog({ kind: 'field', field })} /> : <Empty title={t('noFields')} text={t('noFieldsText')} icon={<Layers3 size={21} />} />}</div></>}
  {page === 'settings' && <><div className="page-heading"><div><span className="eyebrow">{t('settingsEyebrow')}</span><h1>{t('settingsTitle')}</h1><p>{t('settingsText')}</p></div></div><div className="settings-grid"><RequirementSettings key={workbook.id} fields={data.fields} required={requiredItemFields} disabled={!writable} busy={busy} t={t} onSave={saveRequirements} /><section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('accountSettings')}</span></div><div className="settings-content"><div className="setting-row"><span className="setting-icon"><FolderOpen size={19} /></span><div><h3>{workbook.name}</h3><p>{mode === 'demo' ? t('demoAccount') : `${t('signedInAs')} ${email}`}</p></div></div><p className="setting-note">{mode === 'demo' ? t('demoNote') : t('sheetCaution')}</p><div className="setting-actions">{mode === 'google' && <button className="button secondary" disabled={!online || busy || needsRefresh || needsFreshLoad || !!pendingCheck} onClick={() => void changeLedger()}>{t('changeLedger')}</button>}{mode !== 'cache' && <button className="button secondary" disabled={!online || busy || authRequired} onClick={() => void refresh()}><RefreshCw size={16} />{t('refresh')}</button>}<button className="button secondary" disabled={busy} onClick={() => void signOut()}><LogOut size={16} />{t('signOut')}</button></div>{mode !== 'demo' && <p className="form-hint">{t('logoutNote')}</p>}</div></section>{identity && <section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('identitySettings')}</span></div><div className="settings-content"><div className="setting-row"><span className="setting-icon"><ShieldCheck size={19} /></span><div><h3>{identity.user.displayName || identity.user.email}</h3><p>{identity.user.email}</p></div></div><p className="setting-note">{t('identityNote')}</p><p className="setting-note">{t('identityPlan')}: <strong>{appAccess ? (appAccess.allowed ? t('planActive') : t('planMissing')) : t('planUnknown')}</strong></p>{appAccess && !appAccess.allowed && <div className="message warning"><AlertCircle size={17} /><span>{t('subultechAccessWarning')}</span></div>}</div></section>}<section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('language')}</span></div><div className="settings-content"><div className="setting-row"><span className="setting-icon"><Languages size={19} /></span><div><h3>{t('language')}</h3><p>{t('languageText')}</p></div></div><div className="setting-actions">{languageButton}</div></div></section><section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('dataAndExport')}</span></div><div className="settings-content"><p className="setting-note">{t('csvNote')}</p><div className="setting-actions"><button className="button secondary" onClick={() => exportCSV('items')}><Download size={16} />{t('exportMaterials')}</button><button className="button secondary" onClick={() => exportCSV('movements')}><Download size={16} />{t('exportMovements')}</button></div></div></section><section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('cacheSettings')}</span></div><div className="settings-content"><p className="setting-note">{t('cacheSettingsText')}</p></div></section></div></>}
  <footer className="content-footer"><span>RUFOOF / {t('ledger')}</span><span>{t('builtWithAI')}</span></footer></div></main><nav className="mobile-nav" aria-label={t('mainNavigation')}>{nav.map(({ page: target, icon: Icon }) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)} aria-current={page === target ? 'page' : undefined}><Icon size={19} /><span>{t(target)}</span></button>)}</nav></div>{dialog && <Modal title={dialog.kind === 'item' ? t(dialog.item ? 'editMaterial' : 'addMaterial') : dialog.kind === 'movement' ? t('newMovement') : dialog.kind === 'field' ? t(dialog.field ? 'editField' : 'addField') : dialog.kind === 'import' ? t('importTitle') : t('itemDetail')} closeLabel={t('close')} onClose={closeDialog}>{dialog.kind === 'item' && <ItemEditor item={dialog.item} fields={data.fields} required={requiredItemFields} t={t} disabled={!writable} busy={busy} notice={modalNotice} onSave={saveItem} onClose={closeDialog} />}{dialog.kind === 'movement' && <MovementEditor initialItemId={dialog.itemId} data={data} t={t} disabled={!writable} busy={busy} notice={modalNotice} onSave={saveMovement} onClose={closeDialog} />}{dialog.kind === 'field' && <FieldEditor field={dialog.field} t={t} disabled={!writable} busy={busy} notice={modalNotice} onSave={dialog.field ? updateField : saveField} onClose={closeDialog} />}{dialog.kind === 'import' && <ImportDialog existingCodes={existingCodes} fields={data.fields} required={requiredItemFields} t={t} language={language} busy={busy} disabled={!writable} notice={modalNotice} onImport={importItems} onClose={closeDialog} />}{dialog.kind === 'detail' && detailItem && <ItemDetail item={detailItem} data={data} t={t} language={language} writable={writable} onEdit={() => setDialog({ kind: 'item', item: detailItem })} onMove={() => setDialog({ kind: 'movement', itemId: detailItem.id })} />}</Modal>}</div>
}
