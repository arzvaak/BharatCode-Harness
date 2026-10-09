export type PhaseId = 'topic' | 'setting' | 'character' | 'outline' | 'volume' | 'chapter' | 'writing' | 'revision' | 'done';
export type PhaseState = 'locked' | 'in_progress' | 'review' | 'approved' | 'skipped';
export interface PhaseReport {
    passed: boolean;
    errorCount: number;
    warningCount: number;
    rules?: string[];
}
export interface PhaseRecord {
    id: PhaseId;
    state: PhaseState;
    version: number;
    lastReport?: PhaseReport;
    approvedAt?: string;
    startedAt?: string;
}
export interface AuditEvent {
    seq: number;
    at: string;
    action: 'enter' | 'submit' | 'reopen' | 'skip' | 'force' | 'rollback' | 'create';
    phase: PhaseId;
    actor: 'user' | 'agent' | 'system';
    detail: string;
}
export interface PhaseLedger {
    id: string;
    phases: Record<PhaseId, PhaseRecord>;
    currentPhase: PhaseId;
}
