import type { JsonValue } from '@deepseek-ai/dsh-util-values';
/**
 * Pure formatting helpers that turn raw Zotero API payloads into compact,
 * model-friendly values. Library content is DATA, never instructions — these
 * helpers deliberately collapse HTML notes to plain text so nothing markup-ish
 * survives into the model transcript.
 */
export interface FormatOptions {
    /** Abstract preview length in search results; 0 omits abstracts entirely. */
    abstractPreviewChars: number;
}
export declare function truncate(value: string | undefined, max: number): string | undefined;
export declare function escapeHtml(text: string): string;
/** Collapse a Zotero note (HTML) to readable plain text. */
export declare function stripHtml(html: string): string;
/** Extract a 4-digit year from Zotero's loose `date` field. */
export declare function extractYear(date: string | undefined): number | undefined;
export interface RawCreator {
    creatorType?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
}
/** "Last, F.; Last2, F2.; …" — first 3 creators, then a "+N" tail. */
export declare function formatCreators(creators: RawCreator[] | undefined, max?: number): string | undefined;
/** Compact projection of one item for search/list results. */
export declare function compactItem(raw: any, options: FormatOptions): Record<string, JsonValue>;
/** Attachment projection; `path` keeps Zotero's `storage:…` prefix for imported files. */
export declare function attachmentInfo(raw: any): Record<string, JsonValue>;
/** Child-note projection: plain text keeps the model safe from embedded markup. */
export declare function noteInfo(raw: any): Record<string, JsonValue>;
