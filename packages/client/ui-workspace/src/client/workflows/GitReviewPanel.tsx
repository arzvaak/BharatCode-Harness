/** Explicit change capture and evidence recording; submitted outcomes are user declarations. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ArtifactRevision, WorkflowRecord } from '@deepseek-ai/dsh-workspace/types'
import type { DocumentPanelActions } from './DocumentPanel.tsx'
import type { WorkspaceSurfaceActions } from './surfaces.ts'
export function GitReviewPanel(
  props: PropsLocale<'workspace'> & WorkspaceSurfaceActions & DocumentPanelActions & { sessionId: SessionId | null },
) {
  const generation = useRef(0)
  const [change, setChange] = useState<{ commit: string; artifact: ArtifactRevision }>()
  const [record, setRecord] = useState<WorkflowRecord>()
  const [paths, setPaths] = useState('')
  const [detail, setDetail] = useState('')
  const [method, setMethod] = useState<'playwright' | 'devtools' | 'manual' | 'test'>('test')
  const [status, setStatus] = useState<'passed' | 'failed' | 'cancelled'>('passed')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useLayoutEffect(() => {
    ++generation.current
    setChange(undefined)
    setRecord(undefined)
    setError(undefined)
    setBusy(false)
    return () => {
      ++generation.current
    }
  }, [props.sessionId])
  const perform = (operation: () => Promise<void>): void => {
    const epoch = generation.current
    setBusy(true)
    setError(undefined)
    void operation()
      .catch((reason: unknown) => {
        if (generation.current === epoch) setError(String(reason))
      })
      .finally(() => {
        if (generation.current === epoch) setBusy(false)
      })
  }
  return (
    <details>
      <summary>{props.t('coding.gitReview')}</summary>
      {error !== undefined && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy || props.sessionId === null}
        onClick={() => {
          const epoch = generation.current
          const session = props.sessionId
          if (session !== null)
            perform(async () => {
              const value = await props.captureChange?.(session)
              if (generation.current === epoch) {
                setChange(value)
                setRecord(undefined)
              }
            })
        }}
      >
        {props.t('coding.captureChange')}
      </button>
      {change !== undefined && (
        <>
          <code>{change.commit}</code>
          <pre>{change.artifact.text}</pre>
          <p>
            {props.t('coding.verificationOwner')} {props.sessionId}
          </p>
          <button
            type="button"
            disabled={busy || props.sessionId === null || props.requestSelectionEdit === undefined}
            onClick={() => {
              const session = props.sessionId
              if (session !== null)
                perform(async () => {
                  await props.requestSelectionEdit?.(
                    session,
                    change.artifact.path,
                    change.artifact.text,
                    'Verify this captured change with the enabled browser/test tools. Use only the browser session owned by this conversation. Return diagnostics, functional checks, failures and evidence file paths for review; do not modify the change.',
                  )
                })
            }}
          >
            {props.t('coding.requestVerification')}
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const session = props.sessionId
              const epoch = generation.current
              if (session !== null)
                perform(async () => {
                  const value = await props.recordVerification?.(
                    session,
                    change.artifact.id,
                    change.commit,
                    paths
                      .split('\n')
                      .map(path => path.trim())
                      .filter(Boolean),
                    method,
                    status,
                    detail,
                  )
                  if (generation.current === epoch) setRecord(value)
                })
            }}
          >
            <p>{props.t('coding.declaredEvidence')}</p>
            <label>
              {props.t('coding.method')}
              <select
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value as typeof method)
                }}
              >
                {(['test', 'manual', 'playwright', 'devtools'] as const).map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {props.t('coding.outcome')}
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as typeof status)
                }}
              >
                {(['passed', 'failed', 'cancelled'] as const).map(value => (
                  <option key={value} value={value}>
                    {props.t(`analysis.${value === 'passed' ? 'completed' : value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {props.t('coding.evidencePaths')}
              <textarea
                value={paths}
                onChange={(event) => {
                  setPaths(event.target.value)
                }}
              />
            </label>
            <label>
              {props.t('coding.verificationDetail')}
              <textarea
                value={detail}
                onChange={(event) => {
                  setDetail(event.target.value)
                }}
                required
              />
            </label>
            <button disabled={busy || props.recordVerification === undefined || detail.trim() === ''}>
              {props.t('coding.attachEvidence')}
            </button>
          </form>
          {record !== undefined && (
            <p>
              {props.t('coding.evidenceSaved')} {record.revision}
            </p>
          )}
        </>
      )}
    </details>
  )
}
