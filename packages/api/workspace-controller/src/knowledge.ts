/** Project evidence and explicit session handoffs over the existing durable inbox. */
import { retainReferencedSession } from '@deepseek-ai/dsh-session-reference'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
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
  static inject = ['projectKnowledge', 'sessionController', 'sessionQuery', 'sessions']
  private admissionTail: Promise<void> = Promise.resolve()
  /** @param ctx - Core project storage, session commands, and observation services. */
  constructor(ctx: Context) {
    super(ctx, 'projectKnowledgeController', { namespace: 'knowledge' })
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
  search(request: SearchArtifactsRequest): SearchArtifactsResult {
    return this.ctx.projectKnowledge.search(request)
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
      if (observation.header.cwd !== source.path)
        throw new Error('originating session does not belong to selected project')
    }
    if (request.destinationSessionId !== undefined) {
      using observation = await this.ctx.sessionQuery.observeSession(request.destinationSessionId, {
        projectionMode: 'none',
      })
      if (observation.header.cwd !== destination.path)
        throw new Error('destination session does not belong to selected project')
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
              message.source.kind === 'user' &&
              'rpcId' in message.source &&
              String(message.source.rpcId) === String(handoff.id),
          )
        ) {
          if (agent?.resumePendingInput === undefined)
            throw new Error('The active agent runtime cannot resume persisted input.')
          agent.resumePendingInput()
        }
        return handoff
      }
      using observation = await this.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
      const previous = observation.events.find(
        event => event.type === 'project/handoff' && event.data.id === handoff.id,
      )
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
