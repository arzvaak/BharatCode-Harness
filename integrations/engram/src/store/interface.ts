





import type {
  DecayOptions, EngramEdgeType, EngramScope, EntityDetail, EntityId, EntityListFilter,
  EntityListResult, EntityMention, EntityRecord, EpisodeTimelineQuery, EpisodeTimelineResult, ExportData,
  FactListFilter, FactListResult, FactRecord, FactWriteInput,
  ForgettingTombstone, ForgottenAuditRow, ListFilter, ListResult,
  MemoryId, MemoryOutcome, MemoryRecord, ObservationId, ObservationListFilter, ObservationRecord,
  ObservationWriteInput, OperationLogRow, ProfileBlock, ProfileBlockVersion,
  ReviewGrade, ReviewView, SearchQuery, SearchResult, Slot, StoreStats, TimelineQuery, UpdateInput, WriteInput,
} from '../types.ts'


export interface RoomState {
  
  readonly count: number
  
  readonly maxIndex: number
}


export interface PlacardRow {
  readonly room: string | null
  readonly caption: string
}


export interface RouteStop {
  readonly position: number
  readonly id: MemoryId
}


export interface EngramStore {
  
  write(input: WriteInput): Promise<MemoryRecord>
  
  get(id: MemoryId): Promise<MemoryRecord | undefined>
  



  getMany(ids: readonly MemoryId[]): Promise<MemoryRecord[]>
  



  neighbors(id: MemoryId, depth: number): Promise<MemoryRecord[]>
  



  search(query: SearchQuery, queryVector: Float32Array | undefined): Promise<SearchResult>
  
  timeline(query: TimelineQuery): Promise<MemoryRecord[]>
  



  episodeTimeline(query: EpisodeTimelineQuery): Promise<EpisodeTimelineResult>
  
  setSessionSummary(sessionId: string, summary: string): Promise<void>
  
  getSessionSummary(sessionId: string): Promise<string | undefined>
  
  update(input: UpdateInput): Promise<MemoryRecord>
  
  forget(id: MemoryId): Promise<MemoryRecord>
  



  forgetWithTombstone(id: MemoryId, tombstone: ForgettingTombstone): Promise<MemoryRecord>
  
  listForgottenWithTombs(limit: number): Promise<readonly ForgottenAuditRow[]>
  
  reportOutcome(id: MemoryId, outcome: MemoryOutcome): Promise<MemoryRecord | undefined>
  
  scheduleReview(id: MemoryId, grade: ReviewGrade): Promise<MemoryRecord | undefined>
  
  dueReviews(now: number, limit: number): Promise<MemoryRecord[]>
  
  slotCountsByRoom(): Promise<Record<string, RoomState>>
  
  assignSlot(id: MemoryId, slot: Slot): Promise<void>
  




  backfillSlots(capacityNote: (room: string) => void): Promise<number>
  
  routeAppend(id: MemoryId): Promise<void>
  
  routeHas(id: MemoryId): Promise<boolean>
  
  routeList(): Promise<RouteStop[]>
  
  listPlacards(): Promise<PlacardRow[]>
  
  getProfileBlock(scope: EngramScope): Promise<ProfileBlock | undefined>
  




  saveProfileBlock(scope: EngramScope, expectedVersion: number | undefined, content: string, source: ProfileBlockVersion['source']): Promise<ProfileBlock>
  
  listProfileBlockVersions(scope: EngramScope, limit: number): Promise<ProfileBlockVersion[]>
  
  getProfileBlockVersion(scope: EngramScope, version: number): Promise<ProfileBlockVersion | undefined>
  
  restore(id: MemoryId): Promise<MemoryRecord>
  
  topActive(scope: EngramScope, n: number): Promise<MemoryRecord[]>
  
  list(filter: ListFilter): Promise<ListResult>
  
  review(id: MemoryId): Promise<ReviewView | undefined>
  
  recentOps(limit: number): Promise<OperationLogRow[]>
  
  stats(): Promise<StoreStats>
  
  exportAll(): Promise<ExportData>
  
  decay(options: DecayOptions): Promise<number>
  
  findContradictions(embedding: Float32Array, limit?: number): Promise<MemoryRecord[]>
  
  linkEdge(from: MemoryId, to: MemoryId, type: EngramEdgeType): Promise<void>
  
  nearestNeighbor(embedding: Float32Array): Promise<{ record: MemoryRecord; similarity: number } | undefined>
  




  reinforce(id: MemoryId, note: string): Promise<MemoryRecord | undefined>
  
  supersedeMany(input: WriteInput, oldIds: readonly MemoryId[]): Promise<MemoryRecord>
  



  resolveEntities(mentions: readonly EntityMention[]): Promise<readonly EntityRecord[]>
  
  linkNodeEntities(nodeId: MemoryId, entityIds: readonly EntityId[]): Promise<void>
  
  entitiesOfNodes(nodeIds: readonly MemoryId[]): Promise<ReadonlyMap<MemoryId, readonly EntityRecord[]>>
  
  listEntities(filter: EntityListFilter): Promise<EntityListResult>
  
  entityDetail(id: EntityId, memoryLimit: number): Promise<EntityDetail | undefined>
  





  writeFacts(inputs: readonly FactWriteInput[]): Promise<readonly FactRecord[]>
  
  factsOfEntity(filter: FactListFilter): Promise<FactListResult>
  




  createObservation(input: ObservationWriteInput): Promise<ObservationRecord>
  




  refineObservation(id: ObservationId, belief: string, addSourceIds: readonly MemoryId[], embedding?: Float32Array): Promise<ObservationRecord | undefined>
  
  markObservationStale(id: ObservationId): Promise<ObservationRecord | undefined>
  
  confirmObservation(id: ObservationId): Promise<ObservationRecord | undefined>
  
  refuteObservation(id: ObservationId): Promise<ObservationRecord | undefined>
  
  listObservations(filter: ObservationListFilter): Promise<readonly ObservationRecord[]>
  



  nearestObservation(embedding: Float32Array): Promise<{ record: ObservationRecord; similarity: number } | undefined>
  
  audit(op: string, targetId: string, detail: string | null): Promise<void>
  
  hasAudit(op: string, detail: string): Promise<boolean>
  
  listAuditDetails(op: string): Promise<string[]>
  
  clearAudit(op: string, detail: string): Promise<void>
  
  purge(): Promise<void>
  
  close(): Promise<void>
}
