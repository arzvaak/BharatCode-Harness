export type ErrorCode = 'INVALID_FIELD_TYPE' | 'INVALID_ENTRY_ID' | 'ENTRY_NOT_FOUND' | 'GROUP_NOT_FOUND' | 'INVALID_WORLD_BOOK_JSON' | 'UNSUPPORTED_WORLD_BOOK_FORMAT' | 'INVALID_JSON' | 'IMPORT_PATH_REQUIRED' | 'IMPORT_FILE_EMPTY' | 'NO_IMPORTABLE_ENTRIES' | 'IO_FAILURE' | 'INVALID_STATE' | 'NOT_IMPLEMENTED';
export interface PluginError {
    code: ErrorCode;
    message: string;
    details?: unknown;
}
export type Result<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: PluginError;
};
export type InjectTarget = 'system' | 'user' | 'assistant';
export type InjectPosition = 'prepend' | 'append' | 'at_depth';
export interface LoreEntry {
    id: string;
    name: string;
    content: string;
    keywords: string[];
    is_regex: boolean;
    case_sensitive: boolean;
    always_active: boolean;
    enabled: boolean;
    priority: number;
    scan_depth: number;
    inject_target: InjectTarget;
    inject_position: InjectPosition;
    insertion_depth: number;
    book_id: string;
    volume_id?: string;
    tags: string[];
    note?: string;
    version: number;
    created_at: string;
    updated_at: string;
}
export interface LoreGroup {
    id: string;
    name: string;
    entry_ids: string[];
    book_ids: string[];
    enabled: boolean;
    created_at: string;
    updated_at: string;
}
export interface LoreSettings {
    user_replacement?: string;
    injection_budget?: number;
    [key: string]: unknown;
}
export interface InjectionPlan {
    scope: 'lorebook' | 'prompt_front' | 'prompt_back';
    prepend: LoreEntry[];
    append: LoreEntry[];
    atDepth: Array<{
        entry: LoreEntry;
        depth: number;
    }>;
    tokenEstimate: number;
    truncated: Array<{
        entry: LoreEntry;
        reason: 'budget' | 'disabled-group' | 'book-mismatch';
    }>;
    renderedPrepend: string;
    renderedAppend: string;
    builtAt: string;
}
export interface ChapterStats {
    chapterNo: number;
    totalChars: number;
    cjkChars: number;
    paragraphs: number;
    dialogueRatio: number;
    avgSentenceLen: number;
    meetsTarget: boolean;
}
export interface PromptTemplate {
    id: string;
    category: string;
    name: string;
    description: string;
    template: string;
    variables: string[];
    source: 'builtin' | 'user';
    version: number;
}
export interface VersionedFile<T> {
    schemaVersion: number;
    data: T;
}
