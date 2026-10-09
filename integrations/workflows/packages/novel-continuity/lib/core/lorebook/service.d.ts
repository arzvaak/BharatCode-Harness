import type { LoreEntry, LoreGroup, Result } from '../types.ts';
import type { LoreStore } from './store.ts';
import type { CreateEntryParams, CreateGroupParams, ImportParams, ImportResult, UpdateEntryParams, UpdateGroupParams } from './types.ts';
export declare function normalizeInjectTarget(value: unknown): 'system' | 'user' | 'assistant';
export declare function normalizeInjectPosition(value: unknown): 'prepend' | 'append' | 'at_depth';
export interface FileReader {
    (path: string): Promise<string>;
}
export declare class LoreService {
    private readonly store;
    private readonly readExternalFile;
    constructor(store: LoreStore, readExternalFile?: FileReader);
    listEntries(): Promise<LoreEntry[]>;
    getEntry(id: string): Promise<LoreEntry>;
    createEntry(params: CreateEntryParams): Promise<LoreEntry>;
    updateEntry(id: string, params: UpdateEntryParams): Promise<LoreEntry>;
    deleteEntry(id: string): Promise<LoreEntry>;
    toggleEntry(id: string): Promise<LoreEntry>;
    importEntries(params: ImportParams): Promise<ImportResult>;
    listGroups(): Promise<LoreGroup[]>;
    createGroup(params: CreateGroupParams): Promise<LoreGroup>;
    updateGroup(params: UpdateGroupParams): Promise<LoreGroup>;
    deleteGroup(id: string, deleteEntries: boolean): Promise<{
        removedGroup: LoreGroup;
        removedEntries: LoreEntry[];
    }>;
    moveEntryToGroup(entryId: string, targetGroupId?: string): Promise<{
        removedFrom: string[];
        targetGroup: LoreGroup | null;
    }>;
}
export declare function asResult<T>(body: () => Promise<T>): Promise<Result<T>>;
