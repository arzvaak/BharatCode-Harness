import type { InjectPosition, InjectTarget, LoreEntry, LoreGroup } from '../types.ts';
export interface CreateEntryParams {
    name: string;
    content: string;
    keywords?: string | readonly string[];
    is_regex?: boolean;
    case_sensitive?: boolean;
    always_active?: boolean;
    enabled?: boolean;
    priority?: number;
    scan_depth?: number;
    inject_target?: InjectTarget;
    inject_position?: InjectPosition;
    insertion_depth?: number;
    book_id?: string;
    volume_id?: string;
    tags?: string[];
    note?: string;
}
export interface UpdateEntryParams {
    name?: string | null;
    content?: string | null;
    keywords?: string | readonly string[] | null;
    is_regex?: boolean;
    case_sensitive?: boolean;
    always_active?: boolean;
    enabled?: boolean;
    priority?: number;
    scan_depth?: number;
    inject_target?: InjectTarget;
    inject_position?: InjectPosition;
    insertion_depth?: number;
    book_id?: string | null;
    volume_id?: string | null;
    tags?: string[] | null;
    note?: string | null;
}
export interface ImportParams {
    content?: string;
    path?: string;
    book_id?: string;
}
export interface ImportResult {
    source_type: 'operit_entries' | 'sillytavern_worldbook' | 'character_book';
    imported_count: number;
    warning_count: number;
    warnings: string[];
    entries: LoreEntry[];
}
export interface CreateGroupParams {
    name: string;
    entry_ids?: string[];
    book_ids?: string[];
    enabled?: boolean;
}
export interface UpdateGroupParams {
    id: string;
    name?: string;
    entry_ids?: string[];
    add_entry_ids?: string[];
    remove_entry_ids?: string[];
    book_ids?: string[];
    enabled?: boolean;
}
export interface GroupOpResult {
    group?: LoreGroup;
    removedGroups?: LoreGroup[];
    removedEntries?: LoreEntry[];
    movedEntryIds?: string[];
}
