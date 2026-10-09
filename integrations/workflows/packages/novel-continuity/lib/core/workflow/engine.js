export const PHASE_ORDER = [
    'topic', 'setting', 'character', 'outline', 'volume', 'chapter', 'writing', 'revision', 'done',
];
export const PHASE_INDEX = Object.freeze(Object.fromEntries(PHASE_ORDER.map((id, index) => [id, index])));
export function nextPhaseOf(id) {
    const index = PHASE_INDEX[id];
    return index === undefined ? null : (PHASE_ORDER[index + 1] ?? null);
}
function invalid(message) {
    return { code: 'INVALID_STATE', message };
}
export function canEnter(ledger, phaseId) {
    if (!(phaseId in PHASE_INDEX))
        return { ok: false, reason: `未知阶段: ${phaseId}` };
    const previous = PHASE_ORDER[PHASE_INDEX[phaseId] - 1];
    if (previous === undefined)
        return { ok: true };
    const record = ledger.phases[previous];
    if (!record)
        return { ok: false, reason: `前置阶段 ${previous} 尚未建立` };
    if (record.state === 'approved' || record.state === 'skipped')
        return { ok: true };
    return { ok: false, reason: `前置阶段 ${previous} 处于 ${record.state}，需 approved/skipped 后才能进入 ${phaseId}` };
}
export function createLedger(id, now) {
    const phases = Object.fromEntries(PHASE_ORDER.map((phaseId) => [phaseId, { id: phaseId, state: 'locked', version: 0 }]));
    return { id, phases, currentPhase: 'topic' };
}
export function enter(ledger, phaseId, now, actor = 'agent') {
    const gate = canEnter(ledger, phaseId);
    if (!gate.ok)
        return { ok: false, error: invalid(gate.reason) };
    const existing = ledger.phases[phaseId];
    if (existing && (existing.state === 'approved' || existing.state === 'skipped')) {
        return { ok: false, error: invalid(`阶段 ${phaseId} 已 ${existing.state}，不能重复进入（需先驳回）`) };
    }
    const next = clone(ledger);
    next.currentPhase = phaseId;
    next.phases[phaseId] = { ...next.phases[phaseId], state: 'in_progress', startedAt: now };
    const event = { seq: 0, at: now, action: 'enter', phase: phaseId, actor, detail: 'in_progress' };
    return { ok: true, value: { ledger: next, event, seq: 0 } };
}
export function submit(ledger, phaseId, report, now, actor = 'agent') {
    const record = ledger.phases[phaseId];
    if (!record || record.state !== 'in_progress' && record.state !== 'review') {
        return { ok: false, error: invalid(`阶段 ${phaseId} 当前状态 ${record?.state ?? '缺失'}，不能提交`) };
    }
    const next = clone(ledger);
    const target = report.errorCount > 0 ? 'review' : report.passed ? 'approved' : 'review';
    next.phases[phaseId] = {
        ...next.phases[phaseId],
        state: target,
        version: next.phases[phaseId].version + 1,
        lastReport: report,
        ...(target === 'approved' ? { approvedAt: now } : {}),
    };
    const detail = target === 'approved' ? 'approved' : `review(${report.errorCount} errors, ${report.warningCount} warnings)`;
    const event = { seq: 0, at: now, action: 'submit', phase: phaseId, actor, detail };
    return { ok: true, value: { ledger: next, event, seq: 0 } };
}
export function forceApprove(ledger, phaseId, now, actor = 'user') {
    const record = ledger.phases[phaseId];
    if (!record || (record.state !== 'review' && record.state !== 'in_progress')) {
        return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能强制放行`) };
    }
    const next = clone(ledger);
    next.phases[phaseId] = { ...next.phases[phaseId], state: 'approved', approvedAt: now };
    const event = { seq: 0, at: now, action: 'force', phase: phaseId, actor, detail: 'force approved' };
    return { ok: true, value: { ledger: next, event, seq: 0 } };
}
export function reopen(ledger, phaseId, now, actor = 'user') {
    const record = ledger.phases[phaseId];
    if (!record || record.state === 'locked' || record.state === 'approved' || record.state === 'skipped') {
        return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能驳回`) };
    }
    const next = clone(ledger);
    next.phases[phaseId] = { ...next.phases[phaseId], state: 'in_progress' };
    const event = { seq: 0, at: now, action: 'reopen', phase: phaseId, actor, detail: 'reopened' };
    return { ok: true, value: { ledger: next, event, seq: 0 } };
}
export function skip(ledger, phaseId, now, actor = 'user') {
    const record = ledger.phases[phaseId];
    if (!record || (record.state !== 'locked' && record.state !== 'in_progress')) {
        return { ok: false, error: invalid(`阶段 ${phaseId} 状态 ${record?.state ?? '缺失'} 不能跳过`) };
    }
    const next = clone(ledger);
    next.phases[phaseId] = { ...next.phases[phaseId], state: 'skipped' };
    const event = { seq: 0, at: now, action: 'skip', phase: phaseId, actor, detail: 'skipped' };
    return { ok: true, value: { ledger: next, event, seq: 0 } };
}
export function rollback(ledger, target, now, actor = 'user') {
    const current = ledger.phases[ledger.currentPhase];
    if (!current)
        return { ok: false, error: invalid('当前阶段缺失') };
    if (ledger.currentPhase !== 'revision' && ledger.currentPhase !== 'done') {
        return { ok: false, error: invalid(`仅 revision/done 阶段可回退，当前是 ${ledger.currentPhase}`) };
    }
    if (target === 'done' || target === 'revision')
        return { ok: false, error: invalid(`不能回退到 ${target}`) };
    const targetRecord = ledger.phases[target];
    if (!targetRecord || (targetRecord.state !== 'approved' && targetRecord.state !== 'skipped')) {
        return { ok: false, error: invalid(`目标阶段 ${target} 状态 ${targetRecord?.state ?? '缺失'}，需 approved/skipped`) };
    }
    const next = clone(ledger);
    const targetIndex = PHASE_INDEX[target];
    for (const phaseId of PHASE_ORDER) {
        const index = PHASE_INDEX[phaseId];
        if (index > targetIndex && (next.phases[phaseId].state === 'approved' || next.phases[phaseId].state === 'skipped')) {
            const { approvedAt: _dropped, ...rest } = next.phases[phaseId];
            void _dropped;
            next.phases[phaseId] = { ...rest, state: 'locked' };
        }
    }
    next.currentPhase = target;
    const { approvedAt: _targetApprovedAt, ...targetRest } = next.phases[target];
    void _targetApprovedAt;
    next.phases[target] = { ...targetRest, state: 'in_progress', startedAt: now };
    const event = { seq: 0, at: now, action: 'rollback', phase: target, actor, detail: `rolled back from ${ledger.currentPhase}` };
    return { ok: true, value: { ledger: next, event, seq: 0 } };
}
function clone(ledger) {
    return {
        id: ledger.id,
        currentPhase: ledger.currentPhase,
        phases: Object.fromEntries(PHASE_ORDER.map((phaseId) => [phaseId, { ...ledger.phases[phaseId] }])),
    };
}
