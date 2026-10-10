import type { LoreEntry } from '../types.ts';
export interface MatchHit {
    entry: LoreEntry;
    hitKeyword?: string;
    via: 'keyword' | 'regex';
}
export interface MatchOptions {
    caseSensitive?: boolean;
    entryIds?: ReadonlySet<string>;
}
export declare class LoreMatcher {
    private index;
    private regexEntries;
    private regexCache;
    private byId;
    rebuild(entries: readonly LoreEntry[]): void;
    upsert(entry: LoreEntry): void;
    remove(entryId: string): void;
    match(text: string, options?: MatchOptions): MatchHit[];
    stats(): {
        keywordTokens: number;
        regexEntries: number;
        totalEntries: number;
    };
    private compileRegex;
}
