import type { Result } from '../types.ts';
import type { AuditEvent, PhaseId, PhaseLedger, PhaseReport } from './types.ts';
export declare const PHASE_ORDER: readonly PhaseId[];
export declare const PHASE_INDEX: Readonly<Record<PhaseId, number>>;
export declare function nextPhaseOf(id: PhaseId): PhaseId | null;
export declare function canEnter(ledger: PhaseLedger, phaseId: PhaseId): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare function createLedger(id: string, now: string): PhaseLedger;
export declare function enter(ledger: PhaseLedger, phaseId: PhaseId, now: string, actor?: AuditEvent['actor']): Result<{
    ledger: PhaseLedger;
    event: AuditEvent;
    seq: number;
}>;
export declare function submit(ledger: PhaseLedger, phaseId: PhaseId, report: PhaseReport, now: string, actor?: AuditEvent['actor']): Result<{
    ledger: PhaseLedger;
    event: AuditEvent;
    seq: number;
}>;
export declare function forceApprove(ledger: PhaseLedger, phaseId: PhaseId, now: string, actor?: AuditEvent['actor']): Result<{
    ledger: PhaseLedger;
    event: AuditEvent;
    seq: number;
}>;
export declare function reopen(ledger: PhaseLedger, phaseId: PhaseId, now: string, actor?: AuditEvent['actor']): Result<{
    ledger: PhaseLedger;
    event: AuditEvent;
    seq: number;
}>;
export declare function skip(ledger: PhaseLedger, phaseId: PhaseId, now: string, actor?: AuditEvent['actor']): Result<{
    ledger: PhaseLedger;
    event: AuditEvent;
    seq: number;
}>;
export declare function rollback(ledger: PhaseLedger, target: PhaseId, now: string, actor?: AuditEvent['actor']): Result<{
    ledger: PhaseLedger;
    event: AuditEvent;
    seq: number;
}>;
