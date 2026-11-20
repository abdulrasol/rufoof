import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialLanguage, messages } from './i18n'

afterEach(() => vi.unstubAllGlobals())

describe('interface language', () => {
  it('prefers a saved language over browser languages', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en' })
    vi.stubGlobal('navigator', { languages: ['ar-IQ', 'en-US'] })
    expect(initialLanguage()).toBe('en')
  })

  it('chooses the first supported browser language', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'ar-IQ', 'en-US'] })
    expect(initialLanguage()).toBe('ar')
  })

  it('falls back to English when storage is unavailable and no language is supported', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable') } })
    vi.stubGlobal('navigator', { languages: ['fr-FR'] })
    expect(initialLanguage()).toBe('en')
  })

  it('provides both languages for every interface message', () => {
    expect(Object.keys(messages.ar).sort()).toEqual(Object.keys(messages.en).sort())
    expect(Object.values(messages.ar).every(Boolean)).toBe(true)
    expect(Object.values(messages.en).every(Boolean)).toBe(true)
  })
})
