// OWNER: D3.  The list-screen fetch, once.
//
// This is NOT a general API client — it does one thing: GET a D3 list endpoint
// and reduce it to the four values <DataTable> needs.  It exists because eight
// list screens were otherwise about to repeat the same thirty lines of
// useState/useEffect, which is the duplication Phase 2 is meant to prove the
// shared components remove.  Writes, mutations, caching and revalidation are
// deliberately absent; no D3 screen performs a write in Phase 2.
//
// Every response is `{ data }` or `{ error: { message } }` (lib/api.ts), so the
// four outcomes below are exhaustive: in flight, API error, malformed payload,
// rows.
'use client'

import * as React from 'react'
import { type ApiError } from '@/components/shared/error-state'

export type ListData<T> = {
  /** `undefined` until the first response lands — never a fake empty array. */
  rows: T[] | undefined
  loading: boolean
  error: ApiError | null
  /** Re-request and show the loading state — for a failed load. */
  retry: () => void
}

export function useListData<T>(url: string): ListData<T> {
  const [rows, setRows] = React.useState<T[] | undefined>(undefined)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  // The "request is starting" state belongs to whoever starts the request:
  // the initial state above, or `retry` below.  Setting it synchronously in
  // the effect body is what react-hooks/set-state-in-effect forbids.
  React.useEffect(() => {
    let cancelled = false

    fetch(url, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (cancelled) return

        if (!res.ok || body?.error) {
          // Surface the API's own message — an unimplemented route, a 403 from
          // the portal guard and a Postgres CHECK violation all arrive here.
          setError({
            message: body?.error?.message ?? `Request failed (HTTP ${res.status}).`,
          })
          setRows(undefined)
          return
        }
        if (!Array.isArray(body?.data)) {
          setError({
            message: `Unexpected response from ${url} — expected { data: [ … ] }.`,
          })
          setRows(undefined)
          return
        }

        setRows(body.data as T[])
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError({ message: e?.message ?? `Could not reach ${url}.` })
        setRows(undefined)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [url, reloadToken])

  const retry = React.useCallback(() => {
    setLoading(true)
    setError(null)
    setReloadToken((n) => n + 1)
  }, [])

  return { rows, loading, error, retry }
}
