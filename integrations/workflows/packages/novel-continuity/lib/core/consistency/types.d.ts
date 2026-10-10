export interface LedgerEntry {
    entity: string;
    field: string;
    value: string;
    chapterNo: number;
    confidence: 'high' | 'medium' | 'low';
    source?: string;
}
export interface TimelineEvent {
    chapterNo: number;
    bookTime: string;
    event: string;
    sortKey?: string | null;
    createdAt: string;
}
export interface ConsistencyAuditReport {
    auditedThroughChapter: number;
    conflicts: Array<{
        kind: 'ledger-overwrite';
        entity: string;
        field: string;
        history: Array<{
            chapterNo: number;
            value: string;
        }>;
        severity: 'warning' | 'info';
    }>;
    timelineIssues: Array<{
        kind: 'time-regression' | 'missing-time';
        chapterNo: number;
        message: string;
        severity: 'warning' | 'info';
    }>;
    sedimentSuggestions: Array<{
        entity: string;
        field: string;
        value: string;
        chapterNo: number;
        suggestedEntry: string;
    }>;
    ranAt: string;
}
export interface ChapterSummaryRef {
    no: number;
    text: string;
}
