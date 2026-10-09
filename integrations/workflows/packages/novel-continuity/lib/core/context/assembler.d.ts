import type { LoreEntry, LoreGroup } from '../types.ts';
import type { Book } from '../novel/types.ts';
import type { NovelStore } from '../novel/store.ts';
import type { VariableStoreFile } from '../variables/store.ts';
import type { ContextPacket } from './types.ts';
export declare const DEFAULT_CONTEXT_BUDGET = 12000;
export declare const DEFAULT_PREV_CHAPTERS = 3;
export interface AssembleOptions {
    book: Book;
    chapterNo: number;
    chapterBrief?: string;
    contextBudget?: number;
    prevChaptersFull?: number;
    scanHistory?: string[];
    injectionBudget?: number;
    charName?: string;
    userName?: string;
}
export interface AssemblerDeps {
    store: NovelStore;
    loreStore: {
        readEntries(): Promise<LoreEntry[]>;
        readGroups(): Promise<LoreGroup[]>;
        readSettings(): Promise<Record<string, unknown>>;
    };
    variables: VariableStoreFile;
}
export declare class ContextAssembler {
    private readonly deps;
    constructor(deps: AssemblerDeps);
    assemble(options: AssembleOptions): Promise<ContextPacket>;
}
