import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpen, Check,
  ChevronRight, ClipboardCheck, CloudOff, Download, FileSpreadsheet, FolderOpen,
  Languages, Layers3, LayoutDashboard, LogOut, Package, Pencil, Plus, Printer, RefreshCw,
  Search, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Upload, X,
} from 'lucide-react'
import { authorizeGoogle, authorizeGoogleSilently, googleRepository, WorkbookDataError, WorkbookDiscoveryError } from './lib/google'
import { exchangeGoogleToken, fetchApplicationAccess, listSavedWorkbooks, logoutSubultechSession, refreshSubultechSession, saveWorkbookReference, SubultechError } from './lib/subultech'
import type { ApplicationAccess, SubultechSession } from './lib/subultech'
import { createDemoRepository } from './lib/demo'
import { clearSnapshots, listSnapshots, saveSnapshot } from './lib/cache'
import type { CachedSnapshot } from './lib/cache'
import { FieldValueError } from './lib/fields'
import { isRepairableIssue } from './lib/schema'
import type { SchemaIssue } from './lib/schema'
import { getBalance, getRunningBalances, movementDelta, toCSV } from './lib/inventory'
import { buildExportSheets, downloadWorkbook } from './lib/excel'
import { buildPreview, CORE_IMPORTS, mappingProblems, suggestTargets } from './lib/import'
import type { ImportIssueCode, ImportTarget } from './lib/import'
import { clearIdentity, clearSession, isRememberEnabled, loadIdentity, loadLastWorkbook, saveIdentity, saveLastWorkbook, setRememberEnabled } from './lib/session'
import type { LastWorkbook } from './lib/session'
import { readSpreadsheet, SpreadsheetError, toTable } from './lib/spreadsheet'
import type { ImportSheet, ImportTable } from './lib/spreadsheet'
import type { CustomField, FieldTarget, FieldType, GoogleSession, InventoryRepository, Item, Movement, WarehouseData, WorkbookRef } from './lib/types'
import { initialLanguage, messages } from './i18n'
import type { Language, MessageKey } from './i18n'
import './styles.css'

type Translate = (key: MessageKey) => string
type Page = 'overview' | 'materials' | 'movements' | 'stockCount' | 'fields' | 'settings'
type Mode = 'google' | 'demo' | 'cache' | null
type PendingCheck = { target: 'item' | 'movement' | 'field'; id: string }
type Dialog = { kind: 'item'; item?: Item } | { kind: 'movement'; itemId?: string } | { kind: 'detail'; itemId: string } | { kind: 'field'; field?: CustomField } | { kind: 'import' } | null
interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
const coreImportKeys: Record<string, MessageKey> = { code: 'code', name: 'name', unit: 'unit', openingBalance: 'openingBalance', category: 'category', minimumStock: 'minimumStock', location: 'location', notes: 'notes' }
const importIssueKeys: Record<ImportIssueCode, MessageKey> = {
  code: 'importErrCode', name: 'importErrName', unit: 'importErrUnit', openingBalance: 'importErrOpening',
  minimumStock: 'importErrMinimum', customNumber: 'importErrCustomNumber', customDate: 'importErrCustomDate', duplicateCode: 'importErrDuplicate',
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
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span><strong>{t('appName')}</strong><small>{t('ledger')}</small></span></div>
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

function FormField({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return <label className={`form-field${wide ? ' form-wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function CustomInputs({ fields, target, values, onChange, t }: { fields: CustomField[]; target: FieldTarget; values: Record<string, string>; onChange: (values: Record<string, string>) => void; t: Translate }) {
  const defined = fields.filter((field) => field.target === target)
  const unknown = Object.keys(values).filter((key) => !defined.some((field) => field.id === key))
  if (!defined.length && !unknown.length) return null
  return <div className="form-wide custom-fields"><h3>{t('customDetails')}</h3><p className="form-hint">{t('customFieldHelp')}</p><div className="form-grid">{defined.map((field) => <FormField key={field.id} label={field.name}><input type={field.type} step={field.type === 'number' ? 'any' : undefined} value={values[field.id] ?? ''} onChange={(event) => onChange({ ...values, [field.id]: event.target.value })} /></FormField>)}{unknown.map((key) => <FormField key={key} label={`${key} · ${t('unknownField')}`}><input value={values[key]} onChange={(event) => onChange({ ...values, [key]: event.target.value })} /></FormField>)}</div></div>
}

function ItemEditor({ item, fields, t, disabled, busy, notice, onSave, onClose }: { item?: Item; fields: CustomField[]; t: Translate; disabled: boolean; busy: boolean; notice: ReactNode; onSave: (item: Item) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState({ code: item?.code ?? '', name: item?.name ?? '', unit: item?.unit ?? '', openingBalance: String(item?.openingBalance ?? 0), category: item?.category ?? '', minimumStock: item?.minimumStock == null ? '' : String(item.minimumStock), location: item?.location ?? '', notes: item?.notes ?? '', custom: { ...item?.custom } })
  const [error, setError] = useState(false)
  const [draftId] = useState(() => item?.id ?? crypto.randomUUID())
  const update = (key: keyof typeof draft, value: string) => setDraft((old) => ({ ...old, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const openingBalance = Number(draft.openingBalance)
    const minimumStock = draft.minimumStock === '' ? null : Number(draft.minimumStock)
    if (!Number.isFinite(openingBalance) || (minimumStock !== null && !Number.isFinite(minimumStock))) { setError(true); return }
    setError(false)
    const saved = await onSave({ ...item, id: draftId, ...draft, code: draft.code.trim(), name: draft.name.trim(), unit: draft.unit.trim(), openingBalance, minimumStock })
    if (saved) onClose()
  }
  return <form onSubmit={submit}><div className="modal-body">{notice}<div className="form-grid"><FormField label={t('code')}><input required value={draft.code} onChange={(e) => update('code', e.target.value)} /></FormField><FormField label={t('name')}><input required value={draft.name} onChange={(e) => update('name', e.target.value)} /></FormField><FormField label={t('unit')}><input required value={draft.unit} onChange={(e) => update('unit', e.target.value)} /></FormField><FormField label={t('category')}><input value={draft.category} onChange={(e) => update('category', e.target.value)} /></FormField><FormField label={t('openingBalance')} hint={item ? t('openingLocked') : undefined}><input required type="number" step="any" readOnly={!!item} value={draft.openingBalance} onChange={(e) => update('openingBalance', e.target.value)} /></FormField><FormField label={t('minimumStock')}><input type="number" step="any" min="0" value={draft.minimumStock} onChange={(e) => update('minimumStock', e.target.value)} /></FormField><FormField label={t('location')}><input value={draft.location} onChange={(e) => update('location', e.target.value)} /></FormField><FormField label={t('notes')} wide><textarea rows={3} value={draft.notes} onChange={(e) => update('notes', e.target.value)} /></FormField><CustomInputs fields={fields} target="items" values={draft.custom} onChange={(custom) => setDraft((old) => ({ ...old, custom }))} t={t} /></div>{error && <p className="inline-error" role="alert">{t('invalidNumber')}</p>}</div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={disabled}>{busy ? t('saving') : t('save')}</button></div></form>
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

function MaterialsTable({ items, data, hiddenFields, t, language, onDetail }: { items: Item[]; data: WarehouseData; hiddenFields: string[]; t: Translate; language: Language; onDetail: (id: string) => void }) {
  const fields = data.fields.filter((field) => field.target === 'items' && !hiddenFields.includes(field.id))
  return <div className="table-scroll"><table><thead><tr><th>{t('code')}</th><th>{t('material')}</th><th>{t('category')}</th><th>{t('location')}</th>{fields.map((field) => <th key={field.id}>{field.name}</th>)}<th className="number-cell">{t('currentBalance')}</th><th>{t('status')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><span className="code">{item.code}</span></td><td><button className="table-link" onClick={() => onDetail(item.id)}>{item.name}</button><span className="cell-sub">{item.unit}</span></td><td>{item.category || '—'}</td><td>{item.location || '—'}</td>{fields.map((field) => <td key={field.id}>{item.custom[field.id] || '—'}</td>)}<td className="number-cell balance">{numberText(getBalance(item, data.movements), language)} <small>{item.unit}</small></td><td><Status item={item} data={data} t={t} /></td><td><button className="row-action" onClick={() => onDetail(item.id)} aria-label={`${t('details')}: ${item.name}`}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div>
}

function MovementTable({ movements, data, hiddenFields, t, language }: { movements: Movement[]; data: WarehouseData; hiddenFields: string[]; t: Translate; language: Language }) {
  const fields = data.fields.filter((field) => field.target === 'movements' && !hiddenFields.includes(field.id))
  return <div className="table-scroll"><table><thead><tr><th>{t('date')}</th><th>{t('material')}</th><th>{t('type')}</th><th className="number-cell">{t('quantity')}</th><th>{t('party')}</th><th>{t('document')}</th>{fields.map((field) => <th key={field.id}>{field.name}</th>)}</tr></thead><tbody>{movements.map((movement) => { const item = data.items.find((entry) => entry.id === movement.itemId); const delta = movementDelta(movement); return <tr key={movement.id}><td className="date-cell">{movement.date}</td><td><strong>{item?.name || movement.itemId}</strong><span className="cell-sub">{item?.code}</span></td><td><span className={`movement-type ${movement.kind}`}><span className="movement-icon">{movement.kind === 'in' ? <ArrowDownLeft size={14} /> : movement.kind === 'out' ? <ArrowUpRight size={14} /> : <SlidersHorizontal size={14} />}</span>{t(movement.kind)}</span></td><td className={`number-cell balance ${delta > 0 ? 'positive' : ''}`}>{delta > 0 ? '+' : ''}{numberText(delta, language)} <small>{item?.unit}</small></td><td>{movement.party || '—'}</td><td>{movement.document || '—'}</td>{fields.map((field) => <td key={field.id}>{movement.custom[field.id] || '—'}</td>)}</tr> })}</tbody></table></div>
}

function ItemDetail({ item, data, t, language, writable, onEdit, onMove }: { item: Item; data: WarehouseData; t: Translate; language: Language; writable: boolean; onEdit: () => void; onMove: () => void }) {
  const history = getRunningBalances(item, data.movements)
  const custom = Object.entries(item.custom)
  return <div className="modal-body detail-body"><div className="detail-top"><div><span className="code">{item.code}</span><h3>{item.name}</h3><p>{item.category || '—'} <span>·</span> {item.location || '—'}</p></div><div className="detail-balance"><small>{t('currentBalance')}</small><strong>{numberText(getBalance(item, data.movements), language)} <span>{item.unit}</span></strong><Status item={item} data={data} t={t} /></div></div><div className="detail-actions"><button className="button secondary" disabled={!writable} onClick={onEdit}><Plus size={16} />{t('editMaterial')}</button><button className="button primary" disabled={!writable} onClick={onMove}><Plus size={16} />{t('recordMovement')}</button></div><div className="detail-meta"><div><small>{t('openingBalance')}</small><strong>{numberText(item.openingBalance, language)} {item.unit}</strong></div><div><small>{t('minimumStock')}</small><strong>{item.minimumStock === null ? '—' : numberText(item.minimumStock, language)}</strong></div><div><small>{t('notes')}</small><strong>{item.notes || '—'}</strong></div>{custom.map(([key, value]) => <div key={key}><small>{data.fields.find((field) => field.target === 'items' && field.id === key)?.name || key}</small><strong>{value || '—'}</strong></div>)}</div><div className="section-heading compact"><div><span className="eyebrow">{t('ledger')}</span><h3>{t('movementHistory')}</h3></div><span className="section-count">{history.length}</span></div>{history.length ? <div className="table-scroll"><table><thead><tr><th>{t('date')}</th><th>{t('type')}</th><th>{t('document')}</th><th className="number-cell">{t('quantity')}</th><th className="number-cell">{t('balanceAfter')}</th></tr></thead><tbody>{history.map(({ movement, balance }) => <tr key={movement.id}><td>{movement.date}</td><td>{t(movement.kind)}</td><td>{movement.document || '—'}{movement.party && <span className="cell-sub">{movement.party}</span>}{movement.notes && <span className="cell-sub">{movement.notes}</span>}{Object.entries(movement.custom).map(([key, value]) => <span className="cell-sub" key={key}>{data.fields.find((field) => field.target === 'movements' && field.id === key)?.name || key}: {value}</span>)}</td><td className="number-cell">{numberText(movementDelta(movement), language)}</td><td className="number-cell balance">{numberText(balance, language)}</td></tr>)}</tbody></table></div> : <Empty title={t('noMovements')} text={t('noMovementsText')} icon={<Activity size={21} />} />}</div>
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
      const nextSession = await authorizeGoogle()
      if (reconnect && accountId && nextSession.accountId !== accountId) { setError('accountMismatch'); return }
      const nextIdentity = await exchangeGoogleToken(nextSession.accessToken)
      const run = ++identityRun.current
      setIdentity(nextIdentity)
      void verifyAccess(nextIdentity, run)
      const nextRepo = googleRepository(nextSession)
      if (reconnect && workbook) {
        setSession(nextSession); setRepo(nextRepo); setMode('google'); setAuthRequired(false)
        setNeedsFreshLoad(true)
      } else {
        const found = await nextRepo.listWorkbooks()
        const saved = await listSavedWorkbooks(nextIdentity).catch(() => [])
        const byId = new Map(found.map((item) => [item.id, item]))
        const remembered = saved.map((item) => byId.get(item.workbook_id)).filter((item): item is WorkbookRef => !!item)
        const rememberedIds = new Set(remembered.map((item) => item.id))
        const ordered = [...remembered, ...found.filter((item) => !rememberedIds.has(item.id))]
        setSession(nextSession); setRepo(nextRepo); setAccountId(nextSession.accountId); setEmail(nextSession.email)
        setMode('google'); setWorkbooks(ordered); setWorkbook(null); setAuthRequired(false); setNeedsRefresh(false)
      }
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
  const saveItem = (item: Item) => write((repository, id) => repository.saveItem(id, item), (current) => ({ ...current, items: current.items.some((existing) => existing.id === item.id) ? current.items.map((existing) => existing.id === item.id ? item : existing) : [...current.items, item] }), 'updated', { target: 'item', id: item.id })
  const saveMovement = (movement: Movement) => write((repository, id) => repository.appendMovements(id, [movement]), (current) => ({ ...current, movements: [...current.movements, movement] }), 'movementSaved', { target: 'movement', id: movement.id })
  const saveField = (field: CustomField) => write((repository, id) => repository.addField(id, field), (current) => ({ ...current, fields: [...current.fields, field] }), 'fieldAdded', { target: 'field', id: field.id })
  const updateField = (field: CustomField) => write((repository, id) => repository.updateField(id, field), (current) => ({ ...current, fields: current.fields.map((existing) => existing.id === field.id ? { ...existing, type: field.type } : existing) }), 'fieldUpdated', { target: 'field', id: field.id })
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
      if (identity) void logoutSubultechSession(identity).catch(() => { /* Local sign-out continues if the session already expired. */ })
      if (accountId) await clearSnapshots(accountId)
      setMode(null); setSession(null); setIdentity(null); setAppAccess(null); setRepo(null); setWorkbook(null); setWorkbooks(null); setData(emptyData); setAccountId(''); setEmail(''); setDialog(null); setAuthRequired(false); setNeedsRefresh(false); setNeedsFreshLoad(false); setPendingCheck(null); setSchemaIssue(null); resetWorkspaceView()
      await loadSnapshots()
    } catch { setError('signOutError') } finally { finish() }
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
  const verificationPanel = pendingCheck && !needsRefresh && !authRequired ? <div className="verification-panel" role="status"><strong>{t(checkedItem || checkedMovement || checkedField ? 'recordFound' : 'recordNotFound')}</strong><p>{t('reviewBeforeResume')}</p><dl><div><dt>{t('recordId')}</dt><dd>{pendingCheck.id}</dd></div>{checkLines.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl><button type="button" className="button secondary" onClick={() => setPendingCheck(null)}>{t('resumeWrites')}</button></div> : null
  const modalNotice = <>{verificationPanel}{error && <div className="message error" role="alert"><AlertCircle size={17} /><span>{t(error)}{writeDetail && <b dir="ltr"> ({writeDetail})</b>}</span></div>}{!online && <div className="message warning"><CloudOff size={17} /><span>{t('offlineBanner')}</span></div>}{(authRequired || mode === 'cache') && <div className="message warning"><AlertCircle size={17} /><span>{t('expiredBanner')}</span><button type="button" className="text-button" disabled={!online || busy} onClick={() => void connect(true)}>{t('reconnect')}</button></div>}{needsFreshLoad && !needsRefresh && <div className="message warning"><RefreshCw size={17} /><span>{t('refreshCopy')}</span><button type="button" className="text-button" disabled={!online || busy || authRequired} onClick={() => void refresh()}>{t('refresh')}</button></div>}{needsRefresh && <div className="message warning"><AlertCircle size={17} /><span>{t('uncertainBanner')}</span><button type="button" className="text-button" disabled={!online || busy || authRequired || mode === 'cache'} onClick={() => void refresh()}>{t('refresh')}</button></div>}</>
  const languageButton = <button className="language-button" onClick={toggleLanguage} aria-label={t('languageToggle')}><Languages size={17} /><span>{language === 'en' ? 'العربية' : 'English'}</span></button>

  if (!workbook) return <div className="welcome-shell"><header className="welcome-header"><Brand t={t} />{languageButton}</header><main className="welcome-main"><div className="welcome-copy"><span className="eyebrow"><span className="eyebrow-dot" />{t('welcomeEyebrow')}</span><h1>{t('welcomeTitle')}</h1><p>{t('welcomeText')}</p><div className="welcome-register" aria-hidden="true"><div className="register-index"><span>R</span><span>01</span><span>02</span><span>03</span></div><div className="register-paper"><div className="register-paper-top"><span>RUFOOF / {t('register')}</span><BookOpen size={18} /></div><div className="paper-row"><span>01</span><i /><b /></div><div className="paper-row"><span>02</span><i /><b /></div><div className="paper-row"><span>03</span><i /><b /></div><div className="paper-row"><span>04</span><i /><b /></div><div className="paper-footer">{t('appTagline')} <span>✳</span></div></div></div></div><div className="welcome-card"><span className="card-number">{workbooks ? '02' : '01'} / RUFOOF</span>{workbooks ? <><h2>{t('chooseWorkbook')}</h2><p>{t('chooseWorkbookText')}</p>{error && <div className="message error" role="alert"><AlertCircle size={17} />{t(error)}</div>}{authRequired && <button className="button secondary full" disabled={busy || !online} onClick={() => void connect()}>{t('reconnect')}</button>}<div className="workbook-list">{workbooks.length ? workbooks.map((ref) => <button className="workbook-option" key={ref.id} disabled={busy || !online} onClick={() => void openWorkbook(ref)}><span className="option-icon"><FileSpreadsheet size={19} /></span><strong>{ref.name}</strong><ChevronRight size={18} /></button>) : <p className="muted">{t('noWorkbooks')}</p>}</div><form onSubmit={(e) => void createWorkbook(e)} className="create-ledger"><FormField label={t('workbookName')}><input required value={workbookName} placeholder={t('workbookPlaceholder')} onChange={(e) => setWorkbookName(e.target.value)} /></FormField><button className="button primary" disabled={busy || !online || needsRefresh}>{busy ? t('loading') : t('create')}</button></form>{needsRefresh && <p className="form-hint">{t('uncertainBanner')} <button className="text-button" onClick={() => void connect()}>{t('reconnect')}</button></p>}<button className="back-link" onClick={() => { identityRun.current++; setWorkbooks(null); setMode(null); setRepo(null); setSession(null); setIdentity(null); setAppAccess(null); setError(null) }}>{t('back')}</button></> : <><span className="eyebrow">{t('ledger')}</span><h2>{t('googleTitle')}</h2><p>{t('googleText')}</p>{error && <div className="message error" role="alert"><AlertCircle size={17} />{t(error)}</div>}<button className="button primary full google-button" disabled={busy || !online} onClick={() => void connect()}><span className="google-g" aria-hidden="true">G</span>{busy ? t('connecting') : t('googleButton')}<ArrowRight className="button-arrow" size={17} /></button><div className="or-divider"><span>{t('or')}</span></div><button className="button secondary full" disabled={busy} onClick={() => void startDemo()}><BookOpen size={17} />{t('demoButton')}</button><p className="small-note">{t('demoNote')}</p><div className="privacy-note"><CloudOff size={17} /><span>{t('privacyNote')}</span></div>{snapshots.length > 0 && <div className="snapshot-list"><h3>{t('cachedCopies')}</h3><p>{t('cachedHint')}</p>{snapshots.map((snapshot) => <button key={`${snapshot.accountId}-${snapshot.workbook.id}`} className="snapshot-option" onClick={() => openSnapshot(snapshot)}><span><strong>{snapshot.workbook.name}</strong><small>{snapshot.email} · {t('saved')} {new Date(snapshot.savedAt).toLocaleString(language)}</small></span><span>{t('openCopy')} <ChevronRight size={15} /></span></button>)}</div>}</>}</div></main><footer className="welcome-footer"><span>RUFOOF / {t('ledger')}</span><span>{t('builtWithAI')}</span></footer></div>

  return <div className="app-shell"><aside className="sidebar"><Brand t={t} /><div className="sidebar-label">{t('workspace')}</div><nav className="side-nav" aria-label={t('mainNavigation')}>{nav.map(({ page: target, icon: Icon, index }) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)} aria-current={page === target ? 'page' : undefined}><Icon size={19} /><span>{t(target)}</span><small>{index}</small></button>)}</nav><div className="sidebar-bottom"><div className="sidebar-ledger"><span className="sidebar-ledger-icon"><BookOpen size={17} /></span><div><small>{t('workbook')}</small><strong>{workbook.name}</strong></div></div><div className="sidebar-foot">RUFOOF <span>•</span> {t('ledger')}</div></div></aside><div className="app-main"><header className="topbar"><div className="breadcrumb"><span>{t('ledger')}</span><ChevronRight size={14} /><strong>{t(page)}</strong></div><div className="topbar-actions"><span className={`connection ${online ? '' : 'is-offline'}`}><span />{!online ? t('offline') : mode === 'demo' ? t('demo') : mode === 'cache' ? t('readOnly') : t('online')}</span>{languageButton}<button className="avatar" onClick={() => setPage('settings')} aria-label={t('settings')}>{mode === 'demo' ? 'D' : (email[0] || 'R').toUpperCase()}</button></div></header><main className="content"><div className="content-inner"><div className="notices" aria-live="polite">{mode === 'demo' && <div className="message demo-message"><BookOpen size={17} /><span>{t('demoBanner')}</span></div>}{!online && <div className="message warning"><CloudOff size={17} /><span>{t('offlineBanner')}</span></div>}{mode === 'cache' && <div className="message warning"><CloudOff size={17} /><span>{t('cacheBanner')}</span><button className="text-button" disabled={!online || busy} onClick={() => void connect(true)}>{t('reconnect')}</button></div>}{needsFreshLoad && !needsRefresh && <div className="message warning"><RefreshCw size={17} /><span>{t('refreshCopy')}</span><button className="text-button" disabled={!online || busy || authRequired} onClick={() => void refresh()}>{t('refresh')}</button></div>}{authRequired && <div className="message warning"><AlertCircle size={17} /><span>{t('expiredBanner')}</span><button className="text-button" disabled={!online || busy} onClick={() => void connect(true)}>{t('reconnect')}</button></div>}{needsRefresh && <div className="message warning"><AlertCircle size={17} /><span>{t('uncertainBanner')}</span><button className="text-button" disabled={!online || busy || authRequired || mode === 'cache'} onClick={() => void refresh()}>{t('refresh')}</button></div>}{verificationPanel}{schemaIssue && <SchemaIssuePanel issue={schemaIssue} t={t} busy={busy} canRepair={mode === 'google' && !!repo?.repairMissingColumn && online && !authRequired} onRepair={() => void repairSchema()} onReload={() => void refresh()} />}{error && <div className="message error" role="alert"><AlertCircle size={17} /><span>{t(error)}{writeDetail && <b dir="ltr"> ({writeDetail})</b>}</span><button className="dismiss" onClick={() => setError(null)} aria-label={t('dismiss')}><X size={16} /></button></div>}{notice && <div className="message success"><Check size={17} /><span>{t(notice)}</span><button className="dismiss" onClick={() => setNotice(null)} aria-label={t('dismiss')}><X size={16} /></button></div>}</div>
  {page === 'overview' && <><div className="page-heading"><div><span className="eyebrow">{t('dashboardEyebrow')}</span><h1>{t('dashboardTitle')}</h1><p>{t('dashboardText')}</p></div><button className="button primary" disabled={!writable || !data.items.length} onClick={() => setDialog({ kind: 'movement' })}><Plus size={17} />{t('recordMovement')}</button></div><div className="summary-grid"><button className="summary-card" onClick={() => setPage('materials')}><span className="summary-icon"><Package size={20} /></span><span className="summary-label">{t('totalMaterials')}</span><strong>{numberText(data.items.length, language)}</strong><small>{t('allMaterials')} <ArrowRight size={14} /></small><span className="summary-index">01</span></button><button className="summary-card" onClick={() => setPage('movements')}><span className="summary-icon blue"><Activity size={20} /></span><span className="summary-label">{t('totalMovements')}</span><strong>{numberText(data.movements.length, language)}</strong><small>{t('allMovements')} <ArrowRight size={14} /></small><span className="summary-index">02</span></button><button className="summary-card attention-card" onClick={() => { setStockFilter('low'); setPage('materials') }}><span className="summary-icon amber"><AlertCircle size={20} /></span><span className="summary-label">{t('lowStock')}</span><strong>{numberText(lowItems.length, language)}</strong><small>{t('needsAttention')} <ArrowRight size={14} /></small><span className="summary-index">03</span></button></div><div className="section-heading"><div><span className="eyebrow">{t('register')}</span><h2>{t('materials')}</h2><p>{t('materialsText')}</p></div><button className="button text-action" onClick={() => setPage('materials')}>{t('viewAll')} <ArrowRight size={16} /></button></div><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('allMaterials')}</span><span>{numberText(data.items.length, language)} / {t('itemsShort')}</span></div>{data.items.length ? <MaterialsTable items={data.items.slice(0, 5)} data={data} hiddenFields={hiddenFields} t={t} language={language} onDetail={(id) => setDialog({ kind: 'detail', itemId: id })} /> : <Empty title={t('noMaterials')} text={t('noMaterialsText')} />}</div><div className="section-heading activity-heading"><div><span className="eyebrow">{t('ledger')}</span><h2>{t('recentActivity')}</h2></div><button className="button text-action" onClick={() => setPage('movements')}>{t('viewAll')} <ArrowRight size={16} /></button></div><div className="ledger-panel">{sortedMovements.length ? <MovementTable movements={sortedMovements.slice(0, 5)} data={data} hiddenFields={hiddenFields} t={t} language={language} /> : <Empty title={t('noMovements')} text={t('noMovementsText')} icon={<Activity size={21} />} />}</div></>}
  {page === 'materials' && <><div className="page-heading"><div><span className="eyebrow">{t('materialsEyebrow')}</span><h1>{t('materialsTitle')}</h1><p>{t('materialsText')}</p></div><div className="heading-actions"><button className="button secondary" onClick={() => window.print()}><Printer size={17} />{t('print')}</button><button className="button secondary" onClick={() => exportCSV('items')}><Download size={17} />{t('export')}</button><button className="button primary" disabled={!writable} onClick={() => setDialog({ kind: 'item' })}><Plus size={17} />{t('addMaterial')}</button></div></div><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('register')}</span><span>{numberText(filteredItems.length, language)} / {t('itemsShort')}</span></div><div className="filters"><label className="search-input"><Search size={18} /><span className="sr-only">{t('search')}</span><input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder={t('searchMaterials')} /></label><label><span className="sr-only">{t('category')}</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t('allCategories')}</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="sr-only">{t('status')}</span><select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}><option value="">{t('allStatuses')}</option><option value="low">{t('lowStock')}</option><option value="healthy">{t('healthy')}</option></select></label></div>{filteredItems.length ? <MaterialsTable items={filteredItems} data={data} hiddenFields={hiddenFields} t={t} language={language} onDetail={(id) => setDialog({ kind: 'detail', itemId: id })} /> : <Empty title={data.items.length ? t('noResults') : t('noMaterials')} text={data.items.length ? t('noResultsText') : t('noMaterialsText')} />}</div></>}
  {page === 'movements' && <><div className="page-heading"><div><span className="eyebrow">{t('movementsEyebrow')}</span><h1>{t('movementsTitle')}</h1><p>{t('movementsText')}</p></div><div className="heading-actions"><button className="button secondary" onClick={() => window.print()}><Printer size={17} />{t('print')}</button><button className="button secondary" onClick={() => exportCSV('movements')}><Download size={17} />{t('export')}</button><button className="button primary" disabled={!writable || !data.items.length} onClick={() => setDialog({ kind: 'movement' })}><Plus size={17} />{t('recordMovement')}</button></div></div><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('movements')}</span><span>{numberText(filteredMovements.length, language)} / {t('activityShort')}</span></div><div className="filters"><label className="search-input"><Search size={18} /><span className="sr-only">{t('search')}</span><input value={movementSearch} onChange={(e) => setMovementSearch(e.target.value)} placeholder={t('searchMovements')} /></label><label><span className="sr-only">{t('type')}</span><select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="">{t('allKinds')}</option><option value="in">{t('in')}</option><option value="out">{t('out')}</option><option value="adjustment">{t('adjustment')}</option></select></label><label className="filter-date"><span>{t('fromDate')}</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label><label className="filter-date"><span>{t('toDate')}</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label></div>{filteredMovements.length ? <MovementTable movements={filteredMovements} data={data} hiddenFields={hiddenFields} t={t} language={language} /> : <Empty title={data.movements.length ? t('noResults') : t('noMovements')} text={data.movements.length ? t('noResultsText') : t('noMovementsText')} icon={<Activity size={21} />} />}</div></>}
  {page === 'stockCount' && <><div className="page-heading"><div><span className="eyebrow">{t('countEyebrow')}</span><h1>{t('countTitle')}</h1><p>{t('countText')}</p></div></div><div className="count-layout"><div className="ledger-panel count-sheet"><div className="panel-bar"><span><span className="bar-dot" />{t('countPage')}</span><span>{t('page')} / 01</span></div><div className="count-body"><div className="count-instruction"><span className="large-icon"><ClipboardCheck size={24} /></span><div><h2>{t('stockCount')}</h2><p>{t('countHint')}</p></div></div><div className="form-grid"><FormField label={t('countMaterial')} wide><select value={countItem} onChange={(e) => selectCountItem(e.target.value)}><option value="">{t('selectMaterial')}</option>{data.items.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></FormField><FormField label={t('recordedBalance')}><input readOnly value={countBaseline === null ? '—' : numberText(countBaseline, language)} /></FormField><FormField label={t('countedBalance')}><input type="number" min="0" step="any" value={countValue} onChange={(e) => { setCountValue(e.target.value); setCountReview(null) }} /></FormField></div>{countReview && <div className="count-review" role="alert"><strong><AlertCircle size={18} />{t('countChanged')}</strong><p>{t('countChangedText')}</p><div><span>{t('previousBalance')} <b>{numberText(countReview.baseline, language)}</b></span><span>{t('latestBalance')} <b>{numberText(countReview.current, language)}</b></span><span>{t('adjustmentAmount')} <b>{numberText(countReview.counted - countReview.current, language)}</b></span></div></div>}<button className="button primary count-submit" disabled={!writable || !countItem || countValue === ''} onClick={() => void checkCount(!!countReview)}>{busy ? t('saving') : countReview ? t('confirmCount') : t('reviewCount')} <ArrowRight size={16} /></button></div></div><div className="count-aside"><span className="aside-number">01 / 01</span><BookOpen size={21} /><h3>{t('ledger')}</h3><p>{t('countConcurrency')}</p></div></div></>}
  {page === 'fields' && <><div className="page-heading"><div><span className="eyebrow">{t('fieldsEyebrow')}</span><h1>{t('fieldsTitle')}</h1><p>{t('fieldsText')}</p></div><button className="button primary" disabled={!writable} onClick={() => setDialog({ kind: 'field' })}><Plus size={17} />{t('addField')}</button></div><div className="ledger-panel"><div className="panel-bar"><span><span className="bar-dot" />{t('fieldPage')}</span><span>{data.fields.length}</span></div>{data.fields.length ? <div className="table-scroll"><table><thead><tr><th>{t('fieldName')}</th><th>{t('fieldType')}</th><th>{t('fieldTarget')}</th><th>{t('fieldVisible')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead><tbody>{data.fields.map((field) => <tr key={field.id}><td><strong>{field.name}</strong></td><td>{t(field.type === 'date' ? 'dateField' : field.type)}</td><td>{t(field.target === 'items' ? 'materials' : 'movements')}</td><td><input type="checkbox" aria-label={`${t('fieldVisible')}: ${field.name}`} checked={!hiddenFields.includes(field.id)} onChange={(event) => setHiddenFields((current) => event.target.checked ? current.filter((id) => id !== field.id) : [...current, field.id])} /></td><td><button className="row-action" disabled={!writable} onClick={() => setDialog({ kind: 'field', field })} aria-label={`${t('editField')}: ${field.name}`}><Pencil size={16} /></button></td></tr>)}</tbody></table></div> : <Empty title={t('noFields')} text={t('noFieldsText')} icon={<Layers3 size={21} />} />}</div></>}
  {page === 'settings' && <><div className="page-heading"><div><span className="eyebrow">{t('settingsEyebrow')}</span><h1>{t('settingsTitle')}</h1><p>{t('settingsText')}</p></div></div><div className="settings-grid"><section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('accountSettings')}</span></div><div className="settings-content"><div className="setting-row"><span className="setting-icon"><FolderOpen size={19} /></span><div><h3>{workbook.name}</h3><p>{mode === 'demo' ? t('demoAccount') : `${t('signedInAs')} ${email}`}</p></div></div><p className="setting-note">{mode === 'demo' ? t('demoNote') : t('sheetCaution')}</p><div className="setting-actions">{mode === 'google' && <button className="button secondary" disabled={!online || busy || needsRefresh || needsFreshLoad || !!pendingCheck} onClick={() => void changeLedger()}>{t('changeLedger')}</button>}{mode !== 'cache' && <button className="button secondary" disabled={!online || busy || authRequired} onClick={() => void refresh()}><RefreshCw size={16} />{t('refresh')}</button>}<button className="button secondary" disabled={busy} onClick={() => void signOut()}><LogOut size={16} />{t('signOut')}</button></div>{mode !== 'demo' && <p className="form-hint">{t('logoutNote')}</p>}</div></section>{identity && <section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('identitySettings')}</span></div><div className="settings-content"><div className="setting-row"><span className="setting-icon"><ShieldCheck size={19} /></span><div><h3>{identity.user.displayName || identity.user.email}</h3><p>{identity.user.email}</p></div></div><p className="setting-note">{t('identityNote')}</p><p className="setting-note">{t('identityPlan')}: <strong>{appAccess ? (appAccess.allowed ? t('planActive') : t('planMissing')) : t('planUnknown')}</strong></p>{appAccess && !appAccess.allowed && <div className="message warning"><AlertCircle size={17} /><span>{t('subultechAccessWarning')}</span></div>}</div></section>}<section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('language')}</span></div><div className="settings-content"><div className="setting-row"><span className="setting-icon"><Languages size={19} /></span><div><h3>{t('language')}</h3><p>{t('languageText')}</p></div></div><div className="setting-actions">{languageButton}</div></div></section><section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('dataAndExport')}</span></div><div className="settings-content"><p className="setting-note">{t('csvNote')}</p><div className="setting-actions"><button className="button secondary" onClick={() => exportCSV('items')}><Download size={16} />{t('exportMaterials')}</button><button className="button secondary" onClick={() => exportCSV('movements')}><Download size={16} />{t('exportMovements')}</button></div></div></section><section className="ledger-panel settings-section"><div className="panel-bar"><span><span className="bar-dot" />{t('cacheSettings')}</span></div><div className="settings-content"><p className="setting-note">{t('cacheSettingsText')}</p></div></section></div></>}
  <footer className="content-footer"><span>RUFOOF / {t('ledger')}</span><span>{t('builtWithAI')}</span></footer></div></main><nav className="mobile-nav" aria-label={t('mainNavigation')}>{nav.map(({ page: target, icon: Icon }) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)} aria-current={page === target ? 'page' : undefined}><Icon size={19} /><span>{t(target)}</span></button>)}</nav></div>{dialog && <Modal title={dialog.kind === 'item' ? t(dialog.item ? 'editMaterial' : 'addMaterial') : dialog.kind === 'movement' ? t('newMovement') : dialog.kind === 'field' ? t(dialog.field ? 'editField' : 'addField') : t('itemDetail')} closeLabel={t('close')} onClose={closeDialog}>{dialog.kind === 'item' && <ItemEditor item={dialog.item} fields={data.fields} t={t} disabled={!writable} busy={busy} notice={modalNotice} onSave={saveItem} onClose={closeDialog} />}{dialog.kind === 'movement' && <MovementEditor initialItemId={dialog.itemId} data={data} t={t} disabled={!writable} busy={busy} notice={modalNotice} onSave={saveMovement} onClose={closeDialog} />}{dialog.kind === 'field' && <FieldEditor field={dialog.field} t={t} disabled={!writable} busy={busy} notice={modalNotice} onSave={dialog.field ? updateField : saveField} onClose={closeDialog} />}{dialog.kind === 'detail' && detailItem && <ItemDetail item={detailItem} data={data} t={t} language={language} writable={writable} onEdit={() => setDialog({ kind: 'item', item: detailItem })} onMove={() => setDialog({ kind: 'movement', itemId: detailItem.id })} />}</Modal>}</div>
}
