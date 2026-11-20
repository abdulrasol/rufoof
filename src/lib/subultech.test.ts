import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exchangeGoogleToken, fetchApplicationAccess, logoutSubultechSession, refreshSubultechSession, SubultechError } from './subultech'
import type { SubultechSession } from './subultech'

const base = 'https://api.test'
const user = { id: 'usr_1', email: 'a@example.com', display_name: 'A Name', avatar_url: 'https://img/avatar', country: 'iq', city: 'Baghdad', auto_assigned_applications: ['rafuf'] }
const session: SubultechSession = { accessToken: 'access-1', refreshToken: 'refresh-1', user: { id: 'usr_1', email: 'a@example.com', displayName: 'A Name', avatarUrl: 'https://img/avatar', country: 'iq', city: 'Baghdad' } }
const envelope = (data: unknown, code = 'OK') => ({ success: true, code, message: null, data, errors: [], request_id: 'req_1' })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const mockFetch = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init || {}))
  vi.stubGlobal('fetch', mock)
  return mock
}
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

beforeEach(() => {
  vi.stubEnv('VITE_SUBULTECH_API_BASE_URL', base)
  vi.stubEnv('VITE_SUBULTECH_APPLICATION_SLUG', 'rafuf')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('SubulTech identity', () => {
  it('exchanges a Google token for a SubulTech session with the fixed application slug', async () => {
    const mock = mockFetch((url, init) => {
      expect(url).toBe(`${base}/v1/auth/google`)
      expect(init.method).toBe('POST')
      expect(header(init, 'Authorization')).toBeNull()
      expect(JSON.parse(String(init.body))).toEqual({ access_token: 'google-token', application_slug: 'rafuf', country: null, city: null })
      return json(envelope({ access_token: 'access-1', refresh_token: 'refresh-1', user }))
    })
    const result = await exchangeGoogleToken('google-token')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(session)
  })

  it('reports an unconfigured API base without calling the network', async () => {
    vi.stubEnv('VITE_SUBULTECH_API_BASE_URL', '')
    const mock = mockFetch(() => json(envelope({})))
    await expect(exchangeGoogleToken('google-token')).rejects.toMatchObject({ code: 'SUBULTECH_NOT_CONFIGURED' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('maps a rejected Google token to its SubulTech error code and status', async () => {
    mockFetch(() => json({ success: false, code: 'GOOGLE_TOKEN_INVALID', message: 'invalid', data: null }, 401))
    await expect(exchangeGoogleToken('expired')).rejects.toMatchObject({ code: 'GOOGLE_TOKEN_INVALID', status: 401 })
  })

  it('maps a network failure to SUBULTECH_NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(exchangeGoogleToken('google-token')).rejects.toMatchObject({ code: 'SUBULTECH_NETWORK' })
  })

  it('rejects a successful envelope without session tokens', async () => {
    mockFetch(() => json(envelope({ user })))
    await expect(exchangeGoogleToken('google-token')).rejects.toBeInstanceOf(SubultechError)
  })

  it('rotates the token pair and keeps the profile when refresh omits the user', async () => {
    const mock = mockFetch((url, init) => {
      expect(url).toBe(`${base}/v1/auth/refresh`)
      expect(JSON.parse(String(init.body))).toEqual({ refresh_token: 'refresh-1' })
      return json(envelope({ access_token: 'access-2', refresh_token: 'refresh-2' }))
    })
    const result = await refreshSubultechSession(session)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ...session, accessToken: 'access-2', refreshToken: 'refresh-2' })
  })

  it('checks the Rufoof plan with the SubulTech bearer token', async () => {
    mockFetch((url, init) => {
      expect(url).toBe(`${base}/v1/apps/rafuf/access`)
      expect(init.method).toBe('GET')
      expect(header(init, 'Authorization')).toBe('Bearer access-1')
      return json(envelope({ application: { slug: 'rafuf' }, allowed: true, subscription: { plan: 'free' } }))
    })
    await expect(fetchApplicationAccess(session)).resolves.toEqual({ allowed: true, subscription: { plan: 'free' } })
  })

  it('surfaces an expired session from the plan check', async () => {
    mockFetch(() => json({ success: false, code: 'AUTH_INVALID_TOKEN', message: 'expired', data: null }, 401))
    await expect(fetchApplicationAccess(session)).rejects.toMatchObject({ code: 'AUTH_INVALID_TOKEN', status: 401 })
  })

  it('revokes the session with the bearer token', async () => {
    const mock = mockFetch((url, init) => {
      expect(url).toBe(`${base}/v1/auth/logout`)
      expect(init.method).toBe('POST')
      expect(header(init, 'Authorization')).toBe('Bearer access-1')
      return json(envelope(null))
    })
    await expect(logoutSubultechSession(session)).resolves.toBeUndefined()
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
