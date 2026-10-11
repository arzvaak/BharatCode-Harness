/** Open negotiated tool UIs on demand; persist their reviewed input identity. */
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceApp, WorkspaceAppResource } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId, WorkflowRecord } from '@deepseek-ai/dsh-workspace/types'
import type { WorkspaceSurfaceActions } from './surfaces.ts'
const AppFrame = lazy(() => import('./AppFrame.tsx').then(value => ({ default: value.AppFrame })))
export function AppsPanel(
  props: PropsLocale<'workspace'> & WorkspaceSurfaceActions & { sessionId: SessionId | null; projectId: WorkspaceId },
) {
  const generation = useRef(0)
  const [apps, setApps] = useState<readonly WorkspaceApp[]>([])
  const [resource, setResource] = useState<WorkspaceAppResource>()
  const [args, setArgs] = useState('{}')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const record = useRef<WorkflowRecord>()
  const tail = useRef(Promise.resolve())
  useLayoutEffect(() => {
    ++generation.current
    setApps([])
    setResource(undefined)
    setArgs('{}')
    record.current = undefined
    setError(undefined)
    setBusy(false)
    return () => {
      ++generation.current
    }
  }, [props.sessionId, props.projectId])
  const fail = (reason: unknown): void => {
    setError(String(reason))
  }
  const discover = (): void => {
    const epoch = generation.current
    const session = props.sessionId
    if (session === null) return
    setBusy(true)
    void props
      .applications?.(session)
      .then(
        (value) => {
          if (generation.current === epoch) setApps(value)
        },
        (reason: unknown) => {
          if (generation.current === epoch) fail(reason)
        },
      )
      .finally(() => {
        if (generation.current === epoch) setBusy(false)
      })
  }
  const open = (app: WorkspaceApp): void => {
    const epoch = ++generation.current
    const session = props.sessionId
    if (session === null) return
    setBusy(true)
    setResource(undefined)
    setError(undefined)
    record.current = undefined
    void (async () => {
      const value = await props.applicationResource?.(session, app.server, app.tool)
      const saved = (await props.workflowRecords?.(props.projectId))?.find(
        item => item.id === JSON.stringify(['app-state', session, app.server, app.tool]),
      )
      if (generation.current === epoch) {
        record.current = saved
        setArgs(saved?.payload.kind === 'app' ? saved.payload.state : '{}')
        setResource(value)
      }
    })()
      .catch((reason: unknown) => {
        if (generation.current === epoch) fail(reason)
      })
      .finally(() => {
        if (generation.current === epoch) setBusy(false)
      })
  }
  const save = (): void => {
    const epoch = generation.current
    const app = resource?.app
    const session = props.sessionId
    if (app === undefined || session === null) return
    try {
      const value: unknown = JSON.parse(args)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(props.t('apps.invalidArguments'))
    } catch (reason) {
      fail(reason)
      return
    }
    tail.current = tail.current
      .then(async () => {
        if (generation.current !== epoch) return
        const saved = await props.saveWorkflowRecord?.({
          projectId: props.projectId,
          id: JSON.stringify(['app-state', session, app.server, app.tool]),
          title: app.title,
          expectedRevision: record.current?.revision ?? null,
          payload: {
            kind: 'app',
            sessionId: session,
            server: app.server,
            tool: app.tool,
            resourceUri: app.resourceUri,
            state: args,
          },
        })
        if (generation.current === epoch) record.current = saved
      })
      .catch((reason: unknown) => {
        if (generation.current === epoch) fail(reason)
      })
  }
  return (
    <details>
      <summary>{props.t('apps.title')}</summary>
      <p>{props.t('apps.boundary')}</p>
      {error !== undefined && <p role="alert">{error}</p>}
      <button type="button" disabled={busy || props.sessionId === null} onClick={discover}>
        {props.t('apps.discover')}
      </button>
      {apps.map(app => (
        <button
          type="button"
          disabled={busy}
          key={`${app.server}/${app.tool}`}
          onClick={() => {
            open(app)
          }}
        >
          {app.title}
        </button>
      ))}
      {resource !== undefined && (
        <>
          <label>
            {props.t('apps.arguments')}
            <textarea
              value={args}
              onChange={(event) => {
                setArgs(event.target.value)
              }}
            />
          </label>
          <button type="button" onClick={save}>
            {props.t('apps.saveState')}
          </button>
          <button
            type="button"
            onClick={() => {
              ++generation.current
              setResource(undefined)
            }}
          >
            {props.t('apps.close')}
          </button>
          <Suspense fallback={<p>{props.t('surface.loading')}</p>}>
            <AppFrame
              resource={resource}
              argumentsJson={record.current?.payload.kind === 'app' ? record.current.payload.state : '{}'}
              error={fail}
              call={async (tool, input) => {
                const session = props.sessionId
                if (session === null || props.applicationCall === undefined) throw new Error(props.t('apps.unavailable'))
                return await props.applicationCall(
                  session,
                  resource.app.server,
                  resource.app.tool,
                  resource.app.generation,
                  tool,
                  input,
                )
              }}
            />
          </Suspense>
        </>
      )}
    </details>
  )
}
