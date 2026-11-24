import type { ListParams } from './types'

const BASE = '/api/v1'
const TOKEN_KEY = 'procurax.token'

export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

let token: string | null = null
let unauthorizedHandler: (() => void) | null = null

export function loadStoredToken(): string | null {
  try { token = localStorage.getItem(TOKEN_KEY) } catch { token = null }
  return token
}
export function setToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable: token stays in memory only */ }
}
export const getToken = () => token
export function onUnauthorized(fn: (() => void) | null) { unauthorizedHandler = fn }

export function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, path: string, opts: { body?: unknown; params?: ListParams | Record<string, unknown>; auth?: boolean; timeoutMs?: number; formData?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined && !opts.formData) headers['Content-Type'] = 'application/json'
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`
  let res: Response
  const ctrl = opts.timeoutMs ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null
  try {
    res = await fetch(`${BASE}${path}${buildQuery(opts.params)}`, {
      method, headers, signal: ctrl?.signal,
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    })
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      throw new ApiError(0, 'timeout', `The request took longer than ${Math.round((opts.timeoutMs ?? 0) / 1000)}s and was abandoned by the browser. The server may still be working: check the history/executions list before retrying.`)
    }
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check that the backend is running.')
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (res.status === 204) return undefined as T
  let data: unknown = null
  try { data = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const env = (data as { error?: { code?: string; message?: string; details?: unknown }; detail?: unknown } | null)
    const err = env?.error
    if (res.status === 401 && opts.auth !== false) unauthorizedHandler?.()
    let message = err?.message ?? `Request failed (${res.status})`
    if (!err && Array.isArray(env?.detail)) message = 'Validation failed. Please check the form fields.'
    throw new ApiError(res.status, err?.code ?? 'http_error', message, err?.details ?? env?.detail)
  }
  return data as T
}

export const api = {
  get: <T>(path: string, params?: ListParams | Record<string, unknown>, opts?: { timeoutMs?: number }) => request<T>('GET', path, { params, timeoutMs: opts?.timeoutMs }),
  post: <T>(path: string, body?: unknown, opts?: { auth?: boolean; timeoutMs?: number }) => request<T>('POST', path, { body: body ?? {}, auth: opts?.auth, timeoutMs: opts?.timeoutMs }),
  /** Multipart upload (browser sets the boundary header). */
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { body: form, formData: form }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  del: <T = void>(path: string) => request<T>('DELETE', path),
}

/** Client-side ceiling for LLM-backed calls (server-side provider timeouts apply first). */
export const LLM_TIMEOUT_MS = 170_000

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')
