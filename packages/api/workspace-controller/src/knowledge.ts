/** Project evidence and explicit session handoffs over the existing durable inbox. */
import { retainReferencedSession } from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-mcp-resources'
import { publicToolName } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { WorkspaceApp, WorkspaceAppResource } from './types.ts'
import { z } from 'zod'
import { discoverProjectSources } from './source-capture.ts'
import * as WorkspaceTools from './workspace-tools.ts'
import { createHash, randomUUID } from 'node:crypto'
import { reconstructRequest, diffRequests, replayWithoutTools } from './request-review.ts'
import { gitChange } from './git-review.ts'
import type { LanguageReview } from './language-review.ts'
import type { DocumentEvidence } from './document-review.ts'
import schema from '@deepseek-ai/schemastery'
import { executeCapturedNotebook } from './notebook-runner.ts'
import type {} from '@deepseek-ai/dsh-jobs'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkflowRecord,
  SaveWorkflowRecord,
  WorkspaceId,
  CaptureSessionArtifactRequest,
  LinkArtifactsRequest,
  ArtifactRelation,
  SearchArtifactsResult,
  ArtifactRevisionId,
  ArtifactRevision,
  ArtifactInspection,
  RegisterArtifactRequest,
  SearchArtifactsRequest,
  CaptureArtifactsRequest,
  CapturedArtifacts,
  PrepareHandoffRequest,
  PreparedHandoff,
  HandoffId,
  SubmitHandoffRequest,
  AssignWorkflowRequest,
  WorkflowProfile,
} from '@deepseek-ai/dsh-workspace/types'

/** Generated `knowledge` Remote owner, independent of optional integrations. */
export class ProjectKnowledgeController extends TypertRemoteService {
  static inject = ['projectKnowledge', 'workspaceRegistry', 'sessionController', 'sessionQuery', 'sessions']
  static Config = schema.object({
    notebookPython: schema.string().default('python3'),
    notebookCellTimeoutSeconds: schema.natural().min(1).default(120),
  })
  private readonly notebookConfig: { notebookPython: string; notebookCellTimeoutSeconds: number }
  private admissionTail: Promise<void> = Promise.resolve()
  /** @param ctx - Core project storage, session commands, and observation services. */
  constructor(ctx: Context, config: { notebookPython?: string; notebookCellTimeoutSeconds?: number } = {}) {
    super(ctx, 'projectKnowledgeController', { namespace: 'knowledge' })
    this.notebookConfig = ProjectKnowledgeController.Config(config)
    ctx.plugin(WorkspaceTools)
  }

  /** Observe project evidence/journal commits, beginning with a reload anchor.
   * @param projectId - Registered project to observe.
   * @param signal - Viewing lifetime.
   * @returns Coalesced invalidations after durable commits.
   */
  @Remote({ mode: 'stream' })
  async *watch(projectId: WorkspaceId, signal: AbortSignal): AsyncIterable<number> {
    if (this.ctx.workspaceRegistry.get(projectId) === undefined) throw new Error('unknown source project')
    let revision = 0
    let observed = -1
    let wake: (() => void) | undefined
    const stop = this.ctx.on('domain/changed', (change) => {
      if (!['project_knowledge', 'project_workflow_journal'].includes(change.domain) || change.operation !== 'put') return
      const value = change.value as { projectId?: unknown; sourceProjectId?: unknown; destinationProjectId?: unknown }
      if (![value.projectId, value.sourceProjectId, value.destinationProjectId].includes(projectId)) return
      ++revision
      wake?.()
    })
    try {
      while (!signal.aborted) {
        if (observed !== revision) { observed = revision; yield observed; continue }
        await new Promise<void>((resolve) => {
          const done = (): void => { signal.removeEventListener('abort', done); wake = undefined; resolve() }
          wake = done
          signal.addEventListener('abort', done, { once: true })
          if (signal.aborted || observed !== revision) done()
        })
      }
    } finally { stop(); wake?.() }
  }

  /**
   * Internal, read-only request reconstruction; no additional product panel.
   * @param sessionId - Owning session identity.
   * @param step - Logged request step index.
   * @param turn - Logged turn index.
   * @returns Serialized captured request.
   */
  @Remote('requestSnapshot')
  async requestSnapshot(sessionId: SessionId, turn: number, step: number): Promise<string> {
    const log = await this.ctx.sessionQuery.readSession(sessionId)
    return JSON.stringify(reconstructRequest(sessionId, log.events, turn, step))
  }
  /**
   * Compare two logged requests without a model call.
   * @param afterStep - Comparison request step index.
   * @param afterTurn - Comparison turn index.
   * @param beforeStep - Baseline request step index.
   * @param beforeTurn - Baseline turn index.
   * @param sessionId - Owning session identity.
   * @returns Serialized difference between the captured requests.
   */
  @Remote('requestDiff')
  async requestDiff(
    sessionId: SessionId,
    beforeTurn: number,
    beforeStep: number,
    afterTurn: number,
    afterStep: number,
  ): Promise<string> {
    const log = await this.ctx.sessionQuery.readSession(sessionId)
    return JSON.stringify(
      diffRequests(
        reconstructRequest(sessionId, log.events, beforeTurn, beforeStep),
        reconstructRequest(sessionId, log.events, afterTurn, afterStep),
      ),
    )
  }
  /**
   * Explicit paid sensitivity replay. Tool calls are returned as evidence, never dispatched.
   * @param consent - Explicit consent to replay the captured model request.
   * @param removeTools - Tool names to omit from the captured request.
   * @param sessionId - Owning session identity.
   * @param signal - Cancellation signal for the operation.
   * @param step - Logged request step index.
   * @param turn - Logged turn index.
   * @returns Immutable captured replay result.
   */
  @Remote('replayRequest')
  async replayRequest(
    sessionId: SessionId,
    turn: number,
    step: number,
    consent: string,
    removeTools: string[],
    signal: AbortSignal,
  ): Promise<ArtifactRevision> {
    if (consent !== 'paid-replay') throw new Error('Replay requires explicit paid-replay consent')
    const project = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.includes(sessionId))
    const llm = this.ctx.get('llm')
    if (project === undefined || llm === undefined) throw new Error('Replay needs the owning project and a configured model')
    const log = await this.ctx.sessionQuery.readSession(sessionId)
    const original = reconstructRequest(sessionId, log.events, turn, step)
    const request = { ...replayWithoutTools(original, removeTools), signal }
    const chunks: unknown[] = []
    let bytes = 0
    for await (const chunk of llm.stream(request)) {
      signal.throwIfAborted()
      bytes += Buffer.byteLength(JSON.stringify(chunk))
      if (bytes > 256 * 1024) throw new Error('Replay output exceeds complete evidence limit')
      chunks.push(chunk)
    }
    return await this.ctx.projectKnowledge.captureAnalysisOutput(
      project.id,
      `replay:${randomUUID()}`,
      'Paid request sensitivity replay',
      JSON.stringify({
        notice: 'One replay measures sensitivity, not causal proof. No proposed tool calls were executed.',
        sourceSession: sessionId,
        turn,
        step,
        removedTools: removeTools,
        requestDiff: diffRequests(original, request),
        chunks,
      }),
    )
  }
  /**
   * List only negotiated MCP Apps visible to the active session scope.
   * @param sessionId - Owning session identity.
   * @param signal - Cancellation signal for the operation.
   * @returns Apps negotiated within the active session scope.
   */
  @Remote('applications')
  async applications(sessionId: SessionId, signal: AbortSignal): Promise<readonly WorkspaceApp[]> {
    const agent = this.ctx.agents.get(sessionId)
    const resources = this.ctx.get('mcpResources')
    if (agent === undefined || resources === undefined)
      throw new Error('MCP Apps need an active session and a configured MCP resource provider')
    return await resources.applications(agent, signal)
  }
  /**
   * Read only the negotiated UI resource; arbitrary resource URIs are not accepted.
   * @param server - Negotiated MCP server identity.
   * @param sessionId - Owning session identity.
   * @param signal - Cancellation signal for the operation.
   * @param tool - Negotiated tool name.
   * @returns Authorized app resource content.
   */
  @Remote('applicationResource')
  async applicationResource(
    sessionId: SessionId,
    server: string,
    tool: string,
    signal: AbortSignal,
  ): Promise<WorkspaceAppResource> {
    const app = (await this.applications(sessionId, signal)).find(value => value.server === server && value.tool === tool)
    const agent = this.ctx.agents.get(sessionId)
    const resources = this.ctx.get('mcpResources')
    if (app === undefined || agent === undefined || resources === undefined) throw new Error('MCP application is unavailable')
    const value = await resources.applicationResource(server, tool, agent, signal, app.generation)
    const result = z
      .object({ contents: z.array(z.object({ uri: z.string(), mimeType: z.string(), text: z.string() })) })
      .parse(value)
    const content = result.contents.find(
      value => value.uri === app.resourceUri && value.mimeType === 'text/html;profile=mcp-app',
    )
    if (content === undefined || Buffer.byteLength(content.text) > 1024 * 1024)
      throw new Error('MCP app HTML is missing or exceeds the complete resource limit')
    return { app, html: content.text }
  }
  /**
   * App calls pass through the ordinary tool policy pipeline and remain in its owning project journal.
   * @param argumentsJson - JSON arguments passed to the authorized tool.
   * @param generation - App generation authorized for this call.
   * @param hostTool - Tool whose UI resource owns the app.
   * @param server - Negotiated MCP server identity.
   * @param sessionId - Owning session identity.
   * @param signal - Cancellation signal for the operation.
   * @param tool - Negotiated tool name.
   * @returns Serialized authorized tool result.
   */
  @Remote('applicationCall')
  async applicationCall(
    sessionId: SessionId,
    server: string,
    hostTool: string,
    generation: string,
    tool: string,
    argumentsJson: string,
    signal: AbortSignal,
  ): Promise<string> {
    const apps = await this.applications(sessionId, signal)
    const host = apps.find(value => value.server === server && value.tool === hostTool)
    const allowed = host?.allowedTools.includes(tool) === true
    const agent = this.ctx.agents.get(sessionId)
    const tools = this.ctx.get('tools')
    const project = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.includes(sessionId))
    if (
      host === undefined ||
      host.generation !== generation ||
      !allowed ||
      agent === undefined ||
      tools === undefined ||
      project === undefined
    )
      throw new Error('MCP app tool is not allowed in this session')
    if (Buffer.byteLength(argumentsJson) > 128 * 1024) throw new Error('MCP app arguments exceed the bound')
    const args: unknown = JSON.parse(argumentsJson)
    const callId = randomUUID() as ToolCallId
    const fingerprint = (value: string) => ({
      bytes: Buffer.byteLength(value),
      sha256: createHash('sha256').update(value).digest('hex'),
    })
    const payload = { kind: 'app' as const, sessionId, server, tool: hostTool, resourceUri: host.resourceUri }
    const intent = await this.ctx.projectKnowledge.saveWorkflowRecord({
      projectId: project.id,
      id: `app-call:${callId}`,
      expectedRevision: null,
      title: host.title,
      payload: { ...payload, state: JSON.stringify({ tool, arguments: fingerprint(argumentsJson), status: 'pending' }) },
    })
    let state: string
    let json: string
    try {
      const current = (await this.applications(sessionId, signal)).find(
        value => value.server === server && value.tool === hostTool,
      )
      if (current?.generation !== generation || current.resourceUri !== host.resourceUri || !current.allowedTools.includes(tool))
        throw new Error('MCP app connection or permissions changed; reopen the app')
      const result = await tools.execute({
        agent,
        audience: 'app',
        name: publicToolName(server, tool),
        arguments: args,
        signal,
        callId,
      })
      json = JSON.stringify(result.isError ? { content: result.content, isError: true } : result.value)
      state = JSON.stringify({
        tool,
        arguments: fingerprint(argumentsJson),
        status: signal.aborted ? 'cancelled' : result.isError ? 'failed' : 'completed',
        result: fingerprint(json),
      })
    } catch (reason) {
      state = JSON.stringify({ tool, arguments: fingerprint(argumentsJson), status: signal.aborted ? 'cancelled' : 'failed' })
      await this.ctx.projectKnowledge.saveWorkflowRecord({
        ...intent,
        expectedRevision: intent.revision,
        payload: { ...payload, state },
      })
      throw reason
    }
    await this.ctx.projectKnowledge.saveWorkflowRecord({
      ...intent,
      expectedRevision: intent.revision,
      payload: { ...payload, state },
    })
    return json
  }
  /**
   * Capture the complete tracked and untracked Git change at the owning project.
   * @param sessionId - Owning session identity.
   * @param signal - Cancellation signal for the operation.
   * @returns Current Git commit and captured change revision.
   */
  @Remote('captureChange')
  async captureChange(sessionId: SessionId, signal: AbortSignal): Promise<{ commit: string; artifact: ArtifactRevision }> {
    const project = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.includes(sessionId))
    if (project === undefined) throw new Error('Git review session has no project')
    const change = await gitChange(this.ctx, project.path, signal)
    const artifact = await this.ctx.projectKnowledge.captureAnalysisOutput(
      project.id,
      `git:${sessionId}`,
      `Git change at ${change.commit.slice(0, 12)}`,
      change.text,
    )
    return { commit: change.commit, artifact }
  }
  /**
   * Attach declared verification evidence only while its exact Git change is still current.
   * @param changeId - Captured Git change revision.
   * @param commit - Git commit bound to the captured change.
   * @param detail - Human-readable verification evidence.
   * @param method - Verification method used.
   * @param paths - Project evidence paths to capture.
   * @param sessionId - Owning session identity.
   * @param signal - Cancellation signal for the operation.
   * @param status - Declared verification outcome.
   * @returns Persisted verification journal record.
   */
  @Remote('recordVerification')
  async recordVerification(
    sessionId: SessionId,
    changeId: ArtifactRevisionId,
    commit: string,
    paths: string[],
    method: 'playwright' | 'devtools' | 'manual' | 'test',
    status: 'passed' | 'failed' | 'cancelled',
    detail: string,
    signal: AbortSignal,
  ): Promise<WorkflowRecord> {
    const project = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.includes(sessionId))
    if (project === undefined) throw new Error('Verification session has no project')
    const artifact = this.ctx.projectKnowledge.read(changeId)
    const current = await gitChange(this.ctx, project.path, signal)
    if (artifact.projectId !== project.id || current.commit !== commit || current.text !== artifact.text)
      throw new Error('The Git change is stale. Capture and verify the current diff again.')
    const evidence = await Promise.all(
      paths.map(path => this.ctx.projectKnowledge.register({ projectId: project.id, path, kind: 'finding' })),
    )
    const transcript = await this.captureSession({ projectId: project.id, sessionId, title: 'Verification session evidence' })
    const settledChange = await gitChange(this.ctx, project.path, signal)
    if (settledChange.commit !== current.commit || settledChange.text !== current.text)
      throw new Error('The Git change changed while capturing verification evidence. Capture it again.')
    return await this.ctx.projectKnowledge.saveWorkflowRecord({
      projectId: project.id,
      id: randomUUID(),
      title: artifact.title,
      expectedRevision: null,
      payload: {
        kind: 'verification',
        change: changeId,
        commit,
        browserSession: sessionId,
        method,
        status,
        evidence: [...evidence.map(value => value.id), transcript.id],
        detail,
      },
    })
  }
  /**
   * Fetch diagnostics and preview code actions/rename for the exact saved revision.
   * @param character - Zero-based cursor character.
   * @param line - Zero-based cursor line.
   * @param newName - Optional rename target to preview.
   * @param path - Project-owned file path.
   * @param sessionId - Owning session identity.
   * @param signal - Cancellation signal for the operation.
   * @param text - Complete saved file content to check.
   * @returns Diagnostics and proposed edits for the checked revision.
   */
  @Remote('languageReview')
  async languageReview(
    sessionId: SessionId,
    path: string,
    text: string,
    line: number,
    character: number,
    newName: string | undefined,
    signal: AbortSignal,
  ): Promise<LanguageReview> {
    const project = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.includes(sessionId))
    if (project === undefined) throw new Error('Language review session has no project')
    const provider = this.ctx.get('workspaceLanguage')
    if (provider === undefined)
      throw new Error('Language review needs the LSP Actions extension and a configured language server')
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0)
      throw new Error('Invalid language cursor')
    return await provider.review(
      { root: project.path, path, text, position: { line, character }, ...(newName === undefined ? {} : { newName }) },
      signal,
    )
  }
  /**
   * Read captured evidence for a project-owned file without model work.
   * @param path - Project-owned file path.
   * @param sessionId - Owning session identity.
   * @returns Captured source relations and anchored comments.
   */
  @Remote('documentEvidence')
  async documentEvidence(sessionId: SessionId, path: string): Promise<DocumentEvidence> {
    const project = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.includes(sessionId))
    if (project === undefined) throw new Error('Document session has no project')
    const hit = this.ctx.projectKnowledge.latestForPath(project.id, path)
    if (hit === undefined) return { comments: [], sources: [] }
    const artifact = this.ctx.projectKnowledge.read(hit.id)
    const relations = this.ctx.projectKnowledge.related(artifact.id)
    const sources = await Promise.all(
      relations.map(async (relation) => {
        const value = await this.inspect(relation.from === artifact.id ? relation.to : relation.from)
        return { relation, artifact: value.artifact, status: value.status }
      }),
    )
    return {
      artifact,
      sources,
      comments: this.ctx.projectKnowledge
        .workflowRecords(project.id)
        .filter(value => value.payload.kind === 'comment' && value.payload.artifact === artifact.id),
    }
  }
  /**
   * Anchor a comment only when the full saved file matches the selected draft.
   * @param comment - Comment anchored to the selected passage.
   * @param end - Exclusive selection offset.
   * @param path - Project-owned file path.
   * @param sessionId - Owning session identity.
   * @param start - Inclusive selection offset.
   * @param text - Complete saved file content to check.
   * @returns Persisted anchored comment record.
   */
  @Remote('commentSelection')
  async commentSelection(
    sessionId: SessionId,
    path: string,
    text: string,
    start: number,
    end: number,
    comment: string,
  ): Promise<WorkflowRecord> {
    const project = this.ctx.workspaceRegistry.list().find(value => value.sessionIds.includes(sessionId))
    if (project === undefined) throw new Error('Document session has no project')
    const previous = this.ctx.projectKnowledge.latestForPath(project.id, path)
    const artifact = await this.ctx.projectKnowledge.register({
      projectId: project.id,
      path,
      kind: previous?.kind ?? 'manuscript',
      ...(previous === undefined ? {} : { title: previous.title }),
    })
    if (artifact.text !== text) throw new Error('Save the current revision before adding an anchored comment')
    return await this.ctx.projectKnowledge.saveWorkflowRecord({
      projectId: project.id,
      id: randomUUID(),
      title: artifact.title,
      expectedRevision: null,
      payload: { kind: 'comment', artifact: artifact.id, start, end, quote: text.slice(start, end), comment, resolved: false },
    })
  }
  /** Execute a prepared run.
   * @param projectId - Selected project.
   * @param id - Prepared analysis.
   * @param sessionId - Owning live Session.
   * @returns Registered job identity. */
  @Remote('executeNotebook')
  async executeNotebook(projectId: WorkspaceId, id: string, sessionId: SessionId): Promise<string> {
    const project = this.ctx.workspaceRegistry.get(projectId)
    if (project === undefined || !project.sessionIds.includes(sessionId))
      throw new Error('Analysis session does not belong to selected project')
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) throw new Error('Analysis execution requires the jobs service')
    const record = this.ctx.projectKnowledge.workflowRecords(projectId).find(value => value.id === id)
    if (record?.payload.kind !== 'analysis' || record.payload.status !== 'prepared')
      throw new Error('Select a prepared analysis run')
    const payload = record.payload
    const notebook = this.ctx.projectKnowledge.read(payload.notebook)
    const inputs = payload.inputs.map(value => this.ctx.projectKnowledge.read(value))
    const running = await this.ctx.projectKnowledge.saveWorkflowRecord({
      ...record,
      expectedRevision: record.revision,
      payload: { ...payload, status: 'running' },
    })
    const controller = new AbortController()
    try {
      return jobs.start({
        kind: 'analysis',
        owner: sessionId,
        label: record.title,
        run: (job) => {
          let execution = running
          let committing = false
          let capturedOutput: ArtifactRevisionId | undefined
          const done = (async () => {
            try {
              execution = await this.ctx.projectKnowledge.saveWorkflowRecord({
                ...running,
                expectedRevision: running.revision,
                payload: { ...payload, status: 'running', jobId: job.id },
              })
              job.updateProgress('Executing captured notebook inputs')
              const result = await executeCapturedNotebook(
                this.ctx,
                {
                  python: this.notebookConfig.notebookPython,
                  timeout: this.notebookConfig.notebookCellTimeoutSeconds,
                  projectPath: project.path,
                  notebook,
                  inputs,
                  kernel: payload.kernel,
                  parameters: payload.parameters,
                },
                controller.signal,
              )
              controller.signal.throwIfAborted()
              const output = await this.ctx.projectKnowledge.captureAnalysisOutput(
                projectId,
                record.id,
                `${record.title}: executed notebook`,
                result.notebook,
              )
              capturedOutput = output.id
              controller.signal.throwIfAborted()
              const outputId = output.id
              committing = true
              await this.ctx.projectKnowledge.saveWorkflowRecord({
                ...execution,
                expectedRevision: execution.revision,
                payload: {
                  ...payload,
                  jobId: job.id,
                  status: result.status,
                  outputs: [outputId],
                  detail: `${result.environment}\n${result.detail}`,
                },
              })
              job.append(result.detail || output.title)
              return { status: result.status, detail: result.detail, result: JSON.stringify({ output: outputId }) }
            } catch (reason) {
              const message = reason instanceof Error ? reason.message : String(reason)
              const detail = capturedOutput === undefined ? message : `${message}. Captured output retained for inspection.`
              await this.ctx.projectKnowledge.saveWorkflowRecord({
                ...execution,
                expectedRevision: execution.revision,
                payload: {
                  ...payload,
                  jobId: job.id,
                  status: controller.signal.aborted ? 'cancelled' : 'failed',
                  outputs: capturedOutput === undefined ? [] : [capturedOutput],
                  detail,
                },
              })
              return { status: controller.signal.aborted ? ('killed' as const) : ('failed' as const), detail }
            }
          })()
          return {
            done,
            cancel: () => {
              if (!committing) controller.abort(new Error('Analysis cancelled'))
            },
          }
        },
      })
    } catch (reason) {
      await this.ctx.projectKnowledge.saveWorkflowRecord({
        ...running,
        expectedRevision: running.revision,
        payload: { ...payload, status: 'failed', detail: String(reason) },
      })
      throw reason
    }
  }
  /**
   * Read the durable workflow journal for a registered project.
   * @param projectId - Selected project.
   * @returns Durable workflow records for the project.
   */
  @Remote('workflowRecords')
  workflowRecords(projectId: WorkspaceId): readonly WorkflowRecord[] {
    return this.ctx.projectKnowledge.workflowRecords(projectId)
  }
  /**
   * Persist a revision-checked workflow record and validate its project evidence.
   * @param request - Revision checked workflow record.
   * @returns Persisted workflow record with its new revision.
   */
  @Remote('saveWorkflowRecord')
  saveWorkflowRecord(request: SaveWorkflowRecord): Promise<WorkflowRecord> {
    if (request.payload.kind === 'analysis' && request.payload.status !== 'prepared')
      throw new Error('Execution states are owned by the notebook job controller')
    return this.ctx.projectKnowledge.saveWorkflowRecord(request)
  }
  /**
   * Register immutable project evidence.
   * @param request - Explicit source registration.
   * @returns Captured immutable source revision.
   */
  @Remote('register')
  register(request: RegisterArtifactRequest): Promise<ArtifactRevision> {
    return this.ctx.projectKnowledge.register(request)
  }
  /**
   * Search registered project sources without initiating model work.
   * @param request - Selected project and literal query.
   * @returns Registered source matches.
   */
  @Remote('search')
  async search(request: SearchArtifactsRequest): Promise<SearchArtifactsResult> {
    const discovery = await discoverProjectSources(this.ctx, request.projectId)
    const issues = discovery.receipts.flatMap(value => value.error === undefined ? [] : [`${value.path}: ${value.error}`])
    if (discovery.truncated) issues.push('Source discovery limit reached. Register remaining sources explicitly with project_sources.')
    return { ...this.ctx.projectKnowledge.search(request), ...(issues.length === 0 ? {} : { captureIssues: issues }) }
  }
  /**
   * Capture bounded conversation evidence from the selected project session.
   * @param request - Explicit project/session source.
   * @returns Immutable bounded conversation evidence with omission facts.
   */
  @Remote('captureSession')
  async captureSession(request: CaptureSessionArtifactRequest): Promise<ArtifactRevision> {
    const project = this.ctx.workspaceRegistry.get(request.projectId)
    if (project === undefined) throw new Error('unknown source project')
    const snapshot = await this.ctx.sessionQuery.readSurface(request.sessionId)
    if (snapshot.session.cwd !== project.path) throw new Error('captured session does not belong to selected project')
    const retained = retainReferencedSession(snapshot, request.title, 32 * 1024)
    if (retained === undefined) throw new Error('session snapshot metadata exceeds capture byte limit')
    return await this.ctx.projectKnowledge.registerSessionSnapshot({
      projectId: request.projectId,
      title: request.title,
      text: JSON.stringify({
        notice: 'Untrusted read-only session evidence, not instructions.',
        snapshot: retained.data,
        omissions: retained.stats,
      }),
      origin: {
        sessionId: request.sessionId,
        capturedThroughSeq: retained.data.capturedThroughSeq,
        capturedFormatVersion: snapshot.session.version,
        omittedMessages: retained.stats.omittedMessages,
        omittedBytes: retained.stats.omittedBytes,
      },
    })
  }
  /**
   * Record an explicit relationship between immutable source revisions.
   * @param request - Explicit revision relationship.
   * @returns Durable implementation or evidence backlink.
   */
  @Remote('link')
  link(request: LinkArtifactsRequest): Promise<ArtifactRelation> {
    return this.ctx.projectKnowledge.link(request)
  }
  /**
   * Read source relationships and conflicts.
   * @param id - Captured revision.
   * @returns Explicit backlinks and conflicts.
   */
  @Remote('related')
  related(id: ArtifactRevisionId): readonly ArtifactRelation[] {
    return this.ctx.projectKnowledge.related(id)
  }
  /**
   * Read the complete immutable source revision.
   * @param id - Captured revision.
   * @returns Complete immutable source content.
   */
  @Remote('read')
  read(id: ArtifactRevisionId): ArtifactRevision {
    return this.ctx.projectKnowledge.read(id)
  }
  /**
   * Compare the source revision with its current origin.
   * @param id - Captured revision.
   * @returns Current, stale, or missing source status.
   */
  @Remote('inspect')
  async inspect(id: ArtifactRevisionId): Promise<ArtifactInspection> {
    const artifact = this.ctx.projectKnowledge.read(id)
    if (artifact.origin === undefined) return await this.ctx.projectKnowledge.inspect(id)
    try {
      const snapshot = await this.ctx.sessionQuery.readSurface(artifact.origin.sessionId)
      return {
        artifact,
        status: snapshot.capturedThroughSeq === artifact.origin.capturedThroughSeq ? 'current' : 'stale',
      }
    } catch (error) {
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND')
        return { artifact, status: 'missing' }
      throw error
    }
  }
  /**
   * Capture a fresh revision from the existing source origin.
   * @param id - Earlier revision to refresh explicitly.
   * @returns Latest source capture.
   */
  @Remote('refresh')
  refresh(id: ArtifactRevisionId): Promise<ArtifactRevision> {
    const artifact = this.ctx.projectKnowledge.read(id)
    if (artifact.origin !== undefined)
      return this.captureSession({
        projectId: artifact.projectId,
        sessionId: artifact.origin.sessionId,
        title: artifact.title,
      })
    return this.ctx.projectKnowledge.refresh(id)
  }
  /**
   * Capture the selected workspace outputs.
   * @param request - Explicit revision selection.
   * @returns Bounded complete evidence and omissions.
   */
  @Remote('capture')
  capture(request: CaptureArtifactsRequest): CapturedArtifacts {
    return this.ctx.projectKnowledge.capture(request)
  }
  /**
   * Prepare evidence and task identity for an explicit destination.
   * @param request - Objective and explicit evidence/destination selection.
   * @returns Retry-stable prepared task.
   */
  @Remote('prepareHandoff')
  async prepareHandoff(request: PrepareHandoffRequest): Promise<PreparedHandoff> {
    const source = this.ctx.workspaceRegistry.get(request.sourceProjectId)
    const destination = this.ctx.workspaceRegistry.get(request.destinationProjectId)
    if (source === undefined || destination === undefined) throw new Error('handoff project is unavailable')
    if (request.sourceSessionId !== undefined) {
      using observation = await this.ctx.sessionQuery.observeSession(request.sourceSessionId, {
        projectionMode: 'none',
      })
      if (observation.header.cwd !== source.path) throw new Error('originating session does not belong to selected project')
    }
    if (request.destinationSessionId !== undefined) {
      using observation = await this.ctx.sessionQuery.observeSession(request.destinationSessionId, {
        projectionMode: 'none',
      })
      if (observation.header.cwd !== destination.path) throw new Error('destination session does not belong to selected project')
    }
    return await this.ctx.projectKnowledge.prepareHandoff(request)
  }
  /**
   * Read a prepared handoff and its admission receipt.
   * @param id - Prepared handoff.
   * @returns Immutable task and admission receipt.
   */
  @Remote('handoff')
  handoff(id: HandoffId): PreparedHandoff {
    return this.ctx.projectKnowledge.handoff(id)
  }

  /**
   * Read handoffs admitted to the receiving session.
   * @param sessionId - Receiving session.
   * @returns Captured handoffs admitted to that session, in log order.
   */
  @Remote('usingContext')
  async usingContext(sessionId: SessionId): Promise<readonly PreparedHandoff[]> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    const admitted = new Set<string>()
    for (const event of observation.events) {
      const messages =
        event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
      for (const message of messages) {
        if (message.source.kind === 'user' && 'rpcId' in message.source) admitted.add(String(message.source.rpcId))
      }
    }
    return observation.events.flatMap(event =>
      event.type === 'project/handoff' && admitted.has(String(event.data.id)) ? [this.handoff(event.data.id)] : [],
    )
  }

  /**
   * Read the latest explicitly selected session workflow.
   * @param sessionId - Session to inspect without activating an agent.
   * @returns Latest explicit workflow assignment.
   */
  @Remote('workflow')
  async workflow(sessionId: SessionId): Promise<WorkflowProfile | undefined> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    const event = observation.events.findLast(event => event.type === 'workflow/assignment')
    return event?.type === 'workflow/assignment' ? event.data.workflow : undefined
  }
  /**
   * Persist the user-selected workflow before acknowledging it.
   * @param request - Explicit session profile choice.
   * @returns Persisted selected workflow.
   */
  @Remote('assignWorkflow')
  async assignWorkflow(request: AssignWorkflowRequest): Promise<WorkflowProfile> {
    // Cold activation goes through the existing idempotent Session command owner.
    using observation = await this.ctx.sessionQuery.observeSession(request.sessionId, { projectionMode: 'none' })
    if (observation.header.cwd === undefined) throw new Error('workflow destination has no execution directory')
    await this.ctx.sessionController.create({ sessionId: request.sessionId, cwd: observation.header.cwd })
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) throw new Error('workflow destination is unavailable')
    if ((await this.workflow(request.sessionId)) !== request.workflow)
      session.append('workflow/assignment', { workflow: request.workflow })
    if (!(await this.ctx.sessions.flush(session))) throw new Error('workflow requires durable session storage')
    return request.workflow
  }

  /**
   * Admit the prepared task through the durable receiving inbox.
   * @param request - Prepared task identity and user-selected queue or steering mode.
   * @param signal - Remote request lifetime; retry uses the same durable task identity.
   * @returns Submitted handoff only after the receiving inbox crosses a durability checkpoint.
   */
  @Remote('submitHandoff')
  submitHandoff(request: SubmitHandoffRequest, signal: AbortSignal): Promise<PreparedHandoff> {
    const operation = this.admissionTail.then(async () => {
      signal.throwIfAborted()
      const handoff = this.handoff(request.id)
      const project = this.ctx.workspaceRegistry.get(handoff.destinationProjectId)
      if (project === undefined) throw new Error('handoff destination project is unavailable')
      await this.ctx.sessionController.create({ workspaceId: project.id, sessionId: handoff.destinationSessionId })
      const session = this.ctx.sessions.get(handoff.destinationSessionId)
      if (session === undefined || session.header.cwd !== project.path)
        throw new Error('handoff destination does not belong to selected project')
      if (handoff.status === 'submitted') {
        const agent = this.ctx.agents.get(session.id)
        const pending = agent === undefined ? [] : [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
        if (
          pending.some(
            message =>
              message.source.kind === 'user' && 'rpcId' in message.source && String(message.source.rpcId) === String(handoff.id),
          )
        ) {
          if (agent?.resumePendingInput === undefined) throw new Error('The active agent runtime cannot resume persisted input.')
          agent.resumePendingInput()
        }
        return handoff
      }
      using observation = await this.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
      const previous = observation.events.find(event => event.type === 'project/handoff' && event.data.id === handoff.id)
      if (previous?.type === 'project/handoff' && previous.data.mode !== request.mode)
        throw new Error('handoff retry cannot change its admission mode')
      if (handoff.createsSession && !observation.events.some(event => event.type === 'workflow/assignment')) {
        session.append('workflow/assignment', { workflow: handoff.workflow })
      }
      if (previous === undefined)
        session.append('project/handoff', {
          id: handoff.id,
          sourceProjectId: handoff.sourceProjectId,
          ...(handoff.sourceSessionId === undefined ? {} : { sourceSessionId: handoff.sourceSessionId }),
          workflow: handoff.workflow,
          revisionIds: handoff.context.evidence.map(artifact => artifact.id),
          omitted: handoff.context.omitted,
          mode: request.mode,
        })
      // Log evidence intent before dispatch; the existing prompt owner logs exact
      // model-visible text and deduplicates this identity in pending and consumed inboxes.
      if (!(await this.ctx.sessions.flush(session))) throw new Error('handoff requires durable session storage')
      await this.ctx.sessionController.prompt(
        {
          requestId: String(handoff.id) as SessionRequestId,
          sessionId: session.id,
          mode: request.mode,
          content: [{ type: 'text', text: this.ctx.projectKnowledge.renderHandoff(handoff.id) }],
        },
        signal,
      )
      if (!(await this.ctx.sessions.flush(session))) throw new Error('handoff requires durable session storage')
      return await this.ctx.projectKnowledge.acknowledgeHandoff(handoff.id)
    })
    this.admissionTail = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host project knowledge and handoff Remote owner. */
    projectKnowledgeController: ProjectKnowledgeController
  }
}

declare module '@deepseek-ai/dsh-jobs/view' {
  interface JobKindMap {
    analysis: unknown
  }
}
