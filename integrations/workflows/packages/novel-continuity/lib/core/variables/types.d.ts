import type { VersionedFile } from '../types.ts';
export interface VariableStoreData {
    global_variables: Record<string, unknown>;
    book_variables: Record<string, Record<string, unknown>>;
    books: Record<string, BookVariableState>;
}
export interface BookVariableState {
    local_variables: Record<string, unknown>;
    processed_chapter_numbers: number[];
    last_scanned_chapter: number;
}
export type VariableStore = VersionedFile<VariableStoreData>;
export declare function emptyVariableStore(): VariableStoreData;
export interface VariableContext {
    localVariables: Record<string, unknown>;
    bookVariables: Record<string, unknown>;
    globalVariables: Record<string, unknown>;
}
export interface PatchOperation {
    op: 'replace' | 'insert' | 'remove' | 'delta' | 'move';
    path: string;
    value?: unknown;
    from?: string;
    to?: string;
}
