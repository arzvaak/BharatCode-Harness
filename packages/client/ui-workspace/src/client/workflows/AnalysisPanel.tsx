/** Reproducible notebook execution records, distinct from accepted research claims. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useLayoutEffect, useRef, useState } from 'react'
import type { WorkspaceId, WorkflowRecord, WorkflowPayload } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceSurfaceActions } from './surfaces.ts'
import css from './surfaces.module.css'
export function AnalysisPanel(
  props: PropsLocale<'workspace'> &
    WorkspaceSurfaceActions & { projectId: WorkspaceId; sessionId: SessionId | null; refresh: number | string },
) {
  const [records, setRecords] = useState<readonly WorkflowRecord[]>([])
  const [notebook, setNotebook] = useState('')
  const [inputs, setInputs] = useState('')
  const [kernel, setKernel] = useState('python3')
  const [parameters, setParameters] = useState('{}')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const reload = (): void => {
    const epoch = generation.current
    void props.workflowRecords?.(props.projectId).then(
      (value) => {
        if (generation.current === epoch) setRecords(value.filter(record => record.payload.kind === 'analysis'))
      },
      (reason: unknown) => {
        if (generation.current === epoch) setError(String(reason))
      },
    )
  }
  useLayoutEffect(() => {
    ++generation.current
    setRecords([])
    setError(undefined)
    setBusy(false)
    reload()
    return () => {
      ++generation.current
    }
  }, [props.projectId, props.refresh, props.workflowRecords])
  const prepare = (): void => {
    const epoch = generation.current
    setBusy(true)
    setError(undefined)
    void (async () => {
      const parsed: unknown = JSON.parse(parameters)
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.values(parsed).some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))
      )
        throw new Error(props.t('analysis.invalidParameters'))
      const values = parsed as Record<string, string | number | boolean | null>
      const source = await props.registerArtifact({ projectId: props.projectId, path: notebook, kind: 'note' })
      const data = await Promise.all(
        inputs
          .split('\n')
          .filter(value => value.trim() !== '')
          .map(path => props.registerArtifact({ projectId: props.projectId, path, kind: 'source' })),
      )
      const payload: Extract<WorkflowPayload, { kind: 'analysis' }> = {
        kind: 'analysis',
        notebook: source.id,
        inputs: data.map(value => value.id),
        code: source.text,
        kernel,
        environment: 'Configured local Python notebook runtime; execution records exact versions',
        parameters: values,
        outputs: [],
        status: 'prepared',
        detail: '',
      }
      await props.saveWorkflowRecord?.({
        projectId: props.projectId,
        id: randomUUID(),
        title: source.title,
        expectedRevision: null,
        payload,
      })
      if (generation.current === epoch) reload()
    })()
      .catch((reason: unknown) => {
        if (generation.current === epoch) setError(String(reason))
      })
      .finally(() => {
        if (generation.current === epoch) setBusy(false)
      })
  }
  return (
    <div className={css.analysis}>
      <details>
        <summary>{props.t('analysis.prepare')}</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            prepare()
          }}
        >
          <label>
            {props.t('analysis.notebook')}
            <input
              value={notebook}
              onChange={(event) => {
                setNotebook(event.target.value)
              }}
              required
            />
          </label>
          <label>
            {props.t('analysis.inputs')}
            <textarea
              value={inputs}
              onChange={(event) => {
                setInputs(event.target.value)
              }}
            />
          </label>
          <label>
            {props.t('analysis.kernel')}
            <input
              value={kernel}
              onChange={(event) => {
                setKernel(event.target.value)
              }}
              required
            />
          </label>
          <label>
            {props.t('analysis.parameters')}
            <textarea
              value={parameters}
              onChange={(event) => {
                setParameters(event.target.value)
              }}
            />
          </label>
          <button disabled={busy || notebook.trim() === '' || props.saveWorkflowRecord === undefined}>
            {props.t('analysis.capture')}
          </button>
        </form>
      </details>
      {error !== undefined && <p role="alert">{error}</p>}
      <button type="button" onClick={reload}>
        {props.t('surface.refresh')}
      </button>
      {records.map(
        record =>
          record.payload.kind === 'analysis' && (
            <article key={record.id}>
              <strong>{record.title}</strong>
              <span>{props.t(`analysis.${record.payload.status}`)}</span>
              <details>
                <summary>{props.t('analysis.identity')}</summary>
                <pre>{record.payload.environment}</pre>
                <pre>{record.payload.code}</pre>
                <code>{record.payload.notebook}</code>
                {record.payload.inputs.map(id => (
                  <button
                    key={id}
                    type="button"
                    disabled={props.sessionId === null}
                    onClick={() => {
                      const session = props.sessionId
                      const epoch = generation.current
                      if (session !== null)
                        void props.readArtifact(id).then(
                          (artifact) => {
                            if (generation.current === epoch) props.openPreview(session, artifact.path)
                          },
                          (reason: unknown) => {
                            if (generation.current === epoch) setError(String(reason))
                          },
                        )
                    }}
                  >
                    {id.slice(0, 12)}
                  </button>
                ))}
              </details>
              {record.payload.status === 'prepared' && (
                <button
                  type="button"
                  disabled={props.sessionId === null || props.executeNotebook === undefined}
                  onClick={() => {
                    const epoch = generation.current
                    const session = props.sessionId
                    if (session === null) return
                    void props.executeNotebook?.(props.projectId, record.id, session).then(
                      () => {
                        if (generation.current === epoch) reload()
                      },
                      (reason: unknown) => {
                        if (generation.current === epoch) setError(String(reason))
                      },
                    )
                  }}
                >
                  {props.t('analysis.execute')}
                </button>
              )}
              {record.payload.status === 'running' && record.payload.jobId !== undefined && (
                <button
                  type="button"
                  disabled={props.sessionId === null || props.cancelNotebook === undefined}
                  onClick={() => {
                    const session = props.sessionId
                    const jobId = record.payload.kind === 'analysis' ? record.payload.jobId : undefined
                    const epoch = generation.current
                    if (session !== null && jobId !== undefined)
                      void props.cancelNotebook?.(session, jobId).then(
                        () => {
                          if (generation.current === epoch) reload()
                        },
                        (reason: unknown) => {
                          if (generation.current === epoch) setError(String(reason))
                        },
                      )
                  }}
                >
                  {props.t('analysis.cancel')}
                </button>
              )}
              <p>{record.payload.detail}</p>
              {record.payload.outputs.map(id => (
                <button
                  type="button"
                  key={id}
                  onClick={() => {
                    void props.readArtifact(id).then((artifact) => {
                      const url = URL.createObjectURL(new Blob([artifact.text], { type: 'application/x-ipynb+json' }))
                      const anchor = document.createElement('a')
                      anchor.href = url
                      anchor.download = `${record.id}.ipynb`
                      anchor.click()
                      setTimeout(() => {
                        URL.revokeObjectURL(url)
                      }, 1000)
                    })
                  }}
                >
                  {props.t('analysis.export')}
                </button>
              ))}
            </article>
          ),
      )}
    </div>
  )
}
