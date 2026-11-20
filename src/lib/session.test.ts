import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIdentity, clearLastWorkbook, clearSession, isRememberEnabled, loadIdentity, loadLastWorkbook,
  saveIdentity, saveLastWorkbook, setRememberEnabled,
} from './session'
import type { SubultechUser } from './subultech'

const user: SubultechUser = {
  id: 'user-1', email: 'owner@example.test', displayName: 'Owner',
  avatarUrl: null, country: null, city: null,
}
const workbook = { accountId: 'google-1', email: 'owner@example.test', workbook: { id: 'sheet-1', name: 'Warehouse' } }

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('persisted session', () => {
  it('stores only the SubulTech refresh token and the user profile', () => {
    saveIdentity({ refreshToken: 'refresh-1', user })
    expect(localStorage.getItem('rufoof-identity')).not.toContain('access')
    expect(loadIdentity()).toEqual({ refreshToken: 'refresh-1', user })
  })

  it('ignores malformed stored identity instead of restoring it', () => {
    localStorage.setItem('rufoof-identity', JSON.stringify({ refreshToken: '', user }))
    expect(loadIdentity()).toBeNull()
    localStorage.setItem('rufoof-identity', JSON.stringify({ refreshToken: 'refresh-1', user: { id: 'x' } }))
    expect(loadIdentity()).toBeNull()
    expect(localStorage.getItem('rufoof-identity')).toBeNull()
  })

  it('remembers the last workbook for the matching Google account', () => {
    saveLastWorkbook(workbook)
    expect(loadLastWorkbook()).toEqual(workbook)
    expect(loadLastWorkbook()).not.toBe(workbook)
  })

  it('drops invalid workbook references', () => {
    localStorage.setItem('rufoof-last-workbook', JSON.stringify({ accountId: 'google-1', email: 'x', workbook: { id: '', name: 'N' } }))
    expect(loadLastWorkbook()).toBeNull()
  })

  it('clears identity and workbook separately or together', () => {
    saveIdentity({ refreshToken: 'refresh-1', user })
    saveLastWorkbook(workbook)
    clearIdentity()
    expect(loadIdentity()).toBeNull()
    expect(loadLastWorkbook()).toEqual(workbook)
    clearLastWorkbook()
    expect(loadLastWorkbook()).toBeNull()

    saveIdentity({ refreshToken: 'refresh-1', user })
    saveLastWorkbook(workbook)
    clearSession()
    expect(loadIdentity()).toBeNull()
    expect(loadLastWorkbook()).toBeNull()
  })

  it('defaults to remembering and wipes stored data when disabled', () => {
    expect(isRememberEnabled()).toBe(true)
    saveIdentity({ refreshToken: 'refresh-1', user })
    saveLastWorkbook(workbook)
    setRememberEnabled(false)
    expect(isRememberEnabled()).toBe(false)
    expect(loadIdentity()).toBeNull()
    expect(loadLastWorkbook()).toBeNull()
    setRememberEnabled(true)
    expect(isRememberEnabled()).toBe(true)
  })

  it('does not throw when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadIdentity()).toBeNull()
    expect(loadLastWorkbook()).toBeNull()
    expect(isRememberEnabled()).toBe(true)
    expect(() => saveIdentity({ refreshToken: 'refresh-1', user })).not.toThrow()
    expect(() => setRememberEnabled(false)).not.toThrow()
  })
})
