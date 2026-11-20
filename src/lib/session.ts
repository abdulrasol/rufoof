import type { SubultechUser } from './subultech'

const IDENTITY_KEY = 'rufoof-identity'
const WORKBOOK_KEY = 'rufoof-last-workbook'
const REMEMBER_KEY = 'rufoof-remember'

export interface PersistedIdentity {
  refreshToken: string
  user: SubultechUser
}

export interface LastWorkbook {
  accountId: string
  email: string
  workbook: { id: string; name: string }
}

function available(): boolean {
  return typeof localStorage !== 'undefined'
}

function read(key: string): unknown {
  if (!available()) return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function write(key: string, value: unknown): void {
  if (!available()) return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage can be unavailable or full. */ }
}

function remove(key: string): void {
  if (!available()) return
  try { localStorage.removeItem(key) } catch { /* The caller continues with in-memory state. */ }
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function parseUser(value: unknown): SubultechUser | null {
  if (!value || typeof value !== 'object') return null
  const user = value as Record<string, unknown>
  if (typeof user.id !== 'string' || !user.id || typeof user.email !== 'string' || typeof user.displayName !== 'string') return null
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: optionalText(user.avatarUrl),
    country: optionalText(user.country),
    city: optionalText(user.city),
  }
}

export function loadIdentity(): PersistedIdentity | null {
  const value = read(IDENTITY_KEY) as { refreshToken?: unknown; user?: unknown } | null
  if (!value || typeof value.refreshToken !== 'string' || !value.refreshToken) return null
  const user = parseUser(value.user)
  if (!user) { clearIdentity(); return null }
  return { refreshToken: value.refreshToken, user }
}

// Only the SubulTech refresh token is kept; Google and SubulTech access tokens stay in memory.
export function saveIdentity(identity: PersistedIdentity): void {
  write(IDENTITY_KEY, { refreshToken: identity.refreshToken, user: identity.user })
}

export function clearIdentity(): void {
  remove(IDENTITY_KEY)
}

export function loadLastWorkbook(): LastWorkbook | null {
  const value = read(WORKBOOK_KEY) as { accountId?: unknown; email?: unknown; workbook?: { id?: unknown; name?: unknown } } | null
  if (!value || typeof value.accountId !== 'string' || !value.accountId || typeof value.email !== 'string') return null
  if (!value.workbook || typeof value.workbook.id !== 'string' || !value.workbook.id || typeof value.workbook.name !== 'string' || !value.workbook.name) return null
  return { accountId: value.accountId, email: value.email, workbook: { id: value.workbook.id, name: value.workbook.name } }
}

export function saveLastWorkbook(value: LastWorkbook): void {
  if (!value.accountId || !value.workbook.id || !value.workbook.name) return
  write(WORKBOOK_KEY, value)
}

export function clearLastWorkbook(): void {
  remove(WORKBOOK_KEY)
}

export function isRememberEnabled(): boolean {
  if (!available()) return true
  try { return localStorage.getItem(REMEMBER_KEY) !== 'off' } catch { return true }
}

export function setRememberEnabled(enabled: boolean): void {
  if (!available()) return
  try { localStorage.setItem(REMEMBER_KEY, enabled ? 'on' : 'off') } catch { /* The choice applies to this session only. */ }
  if (!enabled) { clearIdentity(); clearLastWorkbook() }
}

export function clearSession(): void {
  clearIdentity()
  clearLastWorkbook()
}
