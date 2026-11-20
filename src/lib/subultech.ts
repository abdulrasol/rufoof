const DEFAULT_SLUG = 'rufoof'

export interface SubultechUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  country: string | null
  city: string | null
}

export interface SubultechSession {
  accessToken: string
  refreshToken: string
  user: SubultechUser
}

export interface ApplicationAccess {
  allowed: boolean
  subscription: unknown
}

export interface SavedWorkbook { id: string; workbook_id: string; workbook_name: string; is_primary: boolean; updated_at: string }

export class SubultechError extends Error {
  constructor(readonly code: string, readonly status?: number, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'SubultechError'
  }
}

type Envelope<T> = { success?: boolean; code?: string; message?: string | null; data?: T | null }

function settings(): { base: string; slug: string } {
  const base = (import.meta.env.VITE_SUBULTECH_API_BASE_URL || '').trim().replace(/\/+$/u, '')
  const slug = (import.meta.env.VITE_SUBULTECH_APPLICATION_SLUG || DEFAULT_SLUG).trim() || DEFAULT_SLUG
  return { base, slug }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const { base } = settings()
  if (!base) throw new SubultechError('SUBULTECH_NOT_CONFIGURED')
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new SubultechError('SUBULTECH_NETWORK')
  }
  let envelope: Envelope<T> | null = null
  try { envelope = await response.json() as Envelope<T> } catch { /* Reported as an invalid response below. */ }
  if (!response.ok || !envelope?.success) {
    throw new SubultechError(envelope?.code || `HTTP_${response.status}`, response.status, envelope?.message || undefined)
  }
  return envelope.data as T
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function optionalText(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function parseSession(data: unknown, previous?: SubultechSession): SubultechSession {
  const value = data as { access_token?: unknown; refresh_token?: unknown; user?: Record<string, unknown> } | null
  if (!value || typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token) {
    throw new SubultechError('SUBULTECH_INVALID_RESPONSE')
  }
  const user = value.user || {}
  const id = text(user.id, previous?.user.id ?? '')
  if (!id) throw new SubultechError('SUBULTECH_INVALID_RESPONSE')
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    user: {
      id,
      email: text(user.email, previous?.user.email ?? ''),
      displayName: text(user.display_name, previous?.user.displayName ?? ''),
      avatarUrl: optionalText(user.avatar_url, previous?.user.avatarUrl ?? null),
      country: optionalText(user.country, previous?.user.country ?? null),
      city: optionalText(user.city, previous?.user.city ?? null),
    },
  }
}

export async function exchangeGoogleToken(googleAccessToken: string, location: { country?: string | null; city?: string | null } = {}): Promise<SubultechSession> {
  const { slug } = settings()
  const data = await call<unknown>('/v1/auth/google', {
    method: 'POST',
    body: JSON.stringify({
      access_token: googleAccessToken,
      application_slug: slug,
      country: location.country || null,
      city: location.city || null,
    }),
  })
  return parseSession(data)
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string, location: { country?: string | null; city?: string | null } = {}): Promise<SubultechSession> {
  const { slug } = settings()
  const data = await call<unknown>('/v1/auth/google/code', {
    method: 'POST',
    body: JSON.stringify({ code, redirect_uri: redirectUri, application_slug: slug, country: location.country || null, city: location.city || null }),
  })
  return parseSession(data)
}

export async function refreshSubultechSession(session: SubultechSession): Promise<SubultechSession> {
  // React StrictMode can start the restore effect twice in development. The
  // refresh endpoint rotates tokens, so concurrent calls with the same token
  // would make the second call fail with 401. Share the in-flight rotation.
  if (sessionRefreshPromise) return sessionRefreshPromise
  sessionRefreshPromise = (async () => {
    const data = await call<unknown>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    })
    return parseSession(data, session)
  })()
  try {
    return await sessionRefreshPromise
  } finally {
    sessionRefreshPromise = null
  }
}

let sessionRefreshPromise: Promise<SubultechSession> | null = null

export async function refreshGoogleAccessToken(session: SubultechSession): Promise<{ accessToken: string; expiresAt: number; accountId: string; email: string; name: string }> {
  const { slug } = settings()
  const data = await call<{ access_token?: unknown; expires_in?: unknown; account_id?: unknown }>('/v1/auth/google/refresh', {
    method: 'POST', body: JSON.stringify({ application_slug: slug }),
  }, session.accessToken)
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.account_id !== 'string' || !data.account_id) throw new SubultechError('SUBULTECH_INVALID_RESPONSE')
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600
  return { accessToken: data.access_token, expiresAt: Date.now() + expiresIn * 1000, accountId: data.account_id, email: session.user.email, name: session.user.displayName || session.user.email }
}

export async function logoutSubultechSession(session: SubultechSession): Promise<void> {
  await call<unknown>('/v1/auth/logout', { method: 'POST' }, session.accessToken)
}

export async function deleteSubultechAccount(session: SubultechSession): Promise<void> {
  await call<unknown>('/v1/me', { method: 'DELETE' }, session.accessToken)
}

export async function fetchApplicationAccess(session: SubultechSession): Promise<ApplicationAccess> {
  const { slug } = settings()
  const data = await call<{ allowed?: unknown; subscription?: unknown } | null>(`/v1/apps/${encodeURIComponent(slug)}/access`, { method: 'GET' }, session.accessToken)
  return { allowed: data?.allowed === true, subscription: data?.subscription ?? null }
}

export async function listSavedWorkbooks(session: SubultechSession): Promise<SavedWorkbook[]> {
  const { slug } = settings()
  return call<SavedWorkbook[]>(`/v1/apps/${encodeURIComponent(slug)}/workbooks`, { method: 'GET' }, session.accessToken)
}

export async function saveWorkbookReference(session: SubultechSession, workbook: { id: string; name: string }, isPrimary = true): Promise<SavedWorkbook> {
  const { slug } = settings()
  return call<SavedWorkbook>(`/v1/apps/${encodeURIComponent(slug)}/workbooks`, {
    method: 'POST', body: JSON.stringify({ workbook_id: workbook.id, workbook_name: workbook.name, is_primary: isPrimary }),
  }, session.accessToken)
}
