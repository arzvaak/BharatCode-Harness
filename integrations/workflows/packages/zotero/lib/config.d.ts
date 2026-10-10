import Schema from '@deepseek-ai/schemastery';
/** All tunables live here — no magic constants in the tool bodies. */
export interface Config {
    /** Zotero desktop HTTP host. */
    host: string;
    /** Zotero local server port (the connector port; default 23119). */
    port: number;
    /** Local API library ID; `0` is the current local user library. */
    libraryId: string;
    /** HTTP request timeout in milliseconds. */
    timeoutMs: number;
    /** Default page size for list tools. */
    defaultLimit: number;
    /** Maximum page size per call. */
    maxLimit: number;
    /** Abstract preview characters in search results (0 disables previews). */
    abstractPreviewChars: number;
    /** Maximum collection/tag rows fetched across pages. */
    listCap: number;
}
export declare const Config: Schema<Config>;
