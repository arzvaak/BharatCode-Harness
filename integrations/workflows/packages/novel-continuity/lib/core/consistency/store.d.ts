import type { LedgerEntry, TimelineEvent } from './types.ts';
export declare const LEDGER_SCHEMA_VERSION = 1;
export declare class LedgerStore {
    private readonly filePath;
    constructor(filePath: string);
    private load;
    private save;
    all(): Promise<LedgerEntry[]>;
    byEntity(entity: string): Promise<LedgerEntry[]>;
    applyChapterPatch(bookId: string, chapterNo: number, chapterText: string): Promise<number>;
    record(entry: Omit<LedgerEntry, 'source'>, source: string): Promise<void>;
    clear(): Promise<void>;
}
export declare class TimelineStore {
    private readonly filePath;
    constructor(filePath: string);
    private load;
    private save;
    all(): Promise<TimelineEvent[]>;
    record(event: Omit<TimelineEvent, 'createdAt'>): Promise<void>;
}
export declare function ledgerFilePath(bookDir: string): string;
export declare function timelineFilePath(bookDir: string): string;
