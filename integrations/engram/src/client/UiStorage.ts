/**
 * UI preference persistence hook: syncs any React state to localStorage under the unified package
 * namespace dsh-engram.ui.*; falls back to the default on privacy mode or storage failure, and
 * downgrades to the default on an illegal value as well.
 * Design: package namespace + key suffix, to avoid colliding with the host or other plugins.
 * @module @kenz1117/dsh-engram/client/UiStorage
 */

import { useCallback, useEffect, useState } from 'react'

/** Namespace: every key gets this prefix. */
const NAMESPACE = 'dsh-engram.ui'

/** Defensive read: returns undefined when localStorage throws (privacy mode / disabled). */
function safeGet(key: string): string | undefined {
  try { return window.localStorage.getItem(key) ?? undefined } catch { return undefined }
}

/** Defensive write: silent on failure (the UI state itself does not depend on the write succeeding). */
function safeSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* silent */ }
}

/** Type guard: checks whether raw is one of the values in the allowed set. */
function isValid<T>(raw: string | undefined, allow: readonly T[]): raw is string & T {
  if (raw === undefined) return false
  return (allow as readonly unknown[]).includes(raw)
}

/**
 * Persisted state: same semantics as useState, lazily reads the initial value from localStorage,
 * and writes back synchronously on change.
 * @param suffix - localStorage key suffix (without the package namespace).
 * @param fallback - default value (used on first entry or a read failure).
 * @param allow - allow-list of legal values; used for both input validation and persistence validation.
 */
export function usePersistedState<T extends string>(
  suffix: string,
  fallback: T,
  allow: readonly T[],
): [T, (next: T) => void] {
  const key = `${NAMESPACE}.${suffix}`
  const [value, setValue] = useState<T>(() => {
    const raw = safeGet(key)
    return isValid<T>(raw, allow) ? raw : fallback
  })
  useEffect(() => { safeSet(key, value) }, [key, value])
  const update = useCallback((next: T) => { setValue(next) }, [])
  return [value, update]
}

/** Persist any string: no allow-list; fits free-form input such as the q query box. */
export function usePersistedString(
  suffix: string,
  fallback: string,
): [string, (next: string) => void] {
  const key = `${NAMESPACE}.${suffix}`
  const [value, setValue] = useState<string>(() => safeGet(key) ?? fallback)
  useEffect(() => { safeSet(key, value) }, [key, value])
  const update = useCallback((next: string) => { setValue(next) }, [])
  return [value, update]
}