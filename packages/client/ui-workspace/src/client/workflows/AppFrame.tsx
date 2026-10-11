/** SDK-negotiated UI bridge. Tool requests remain session-scoped Host operations. */
import { useLayoutEffect, useRef } from 'react'
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import { specTypeSchemas } from '@modelcontextprotocol/client'
import type { WorkspaceAppResource } from '@deepseek-ai/dsh-api-workspace-controller/types'
import { sandboxDocument } from './app-sandbox.ts'
export function AppFrame(props: {
  resource: WorkspaceAppResource
  argumentsJson: string
  call: (tool: string, args: string) => Promise<string>
  error: (reason: unknown) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  useLayoutEffect(() => {
    const element = frame.current
    const view = element?.contentWindow
    if (element === null || view === undefined || view === null) return
    const state = { disposed: false }
    const isDisposed = (): boolean => state.disposed
    const bridge = new AppBridge(
      null,
      { name: 'BharatCode', version: '0.2.0' },
      { serverTools: {}, sandbox: { csp: { connectDomains: [], resourceDomains: [] } } },
      { hostContext: { displayMode: 'inline', availableDisplayModes: ['inline'] } },
    )
    bridge.oncalltool = async (request) => {
      if (isDisposed() || !props.resource.app.allowedTools.includes(request.name)) throw new Error('App tool is not allowed')
      const value = await props.call(request.name, JSON.stringify(request.arguments ?? {}))
      if (isDisposed()) throw new Error('App view was disposed')
      const parsed = specTypeSchemas.CallToolResult['~standard'].validate(JSON.parse(value))
      if (parsed.issues !== undefined) throw new Error('MCP app tool returned an invalid result')
      return parsed.value
    }
    bridge.addEventListener('initialized', () => {
      const input: unknown = JSON.parse(props.argumentsJson)
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        props.error(new Error('App input must be an object'))
        return
      }
      if (!isDisposed())
        void bridge.sendToolInput({ arguments: input as Record<string, unknown> }).catch((reason: unknown) => {
          if (!isDisposed()) props.error(reason)
        })
    })
    bridge.addEventListener('sizechange', (size) => {
      if (!isDisposed() && Number.isFinite(size.height))
        element.style.height = `${Math.max(120, Math.min(size.height ?? 400, 900))}px`
    })
    const transport = new PostMessageTransport(view, view)
    void bridge.connect(transport).then(
      () => {
        if (!isDisposed()) element.srcdoc = sandboxDocument(props.resource.html)
      },
      (reason: unknown) => {
        if (!isDisposed()) props.error(reason)
      },
    )
    return () => {
      state.disposed = true
      void bridge.close()
      element.srcdoc = ''
    }
  }, [props.resource])
  return (
    <iframe
      ref={frame}
      title={props.resource.app.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height: 400, border: 0 }}
    />
  )
}
