import type { LoreEntry, LoreGroup, LoreSettings } from '../types.ts';
export declare const STORE_SCHEMA_VERSION = 1;
export declare const DEFAULT_BACKUP_KEEP = 5;
export declare function safeFileName(name: string): string;
export declare class LoreStore {
    readonly baseDir: string;
    private readonly keepBackups;
    constructor(baseDir: string, options?: {
        keepBackups?: number;
    });
    ensureDir(): Promise<void>;
    private filePath;
    private writeJsonAtomic;
    private readJson;
    readEntries(): Promise<LoreEntry[]>;
    writeEntries(entries: LoreEntry[]): Promise<void>;
    readGroups(): Promise<LoreGroup[]>;
    writeGroups(groups: LoreGroup[]): Promise<void>;
    readSettings(): Promise<LoreSettings>;
    writeSettings(settings: LoreSettings): Promise<void>;
    private writeVersioned;
}
