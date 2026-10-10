/**
 * Minimal HTTP client for the Zotero desktop local server (127.0.0.1:23119).
 *
 * Two endpoint families live on the same port:
 * - `/api/users/{id}/...`  Zotero 7+ local API, a read-only mirror of the web API.
 * - `/connector/...`       the connector server the browser extension uses; `saveItems`
 *                          is the only sanctioned localhost write path.
 *
 * Kept dependency-free (plain fetch) so it can be exercised standalone.
 */
export declare class ZoteroError extends Error {
    readonly status?: number | undefined;
    readonly url?: string | undefined;
    constructor(message: string, status?: number | undefined, url?: string | undefined);
}
export interface ZoteroClientOptions {
    /** Zotero desktop HTTP host. */
    host: string;
    /** Zotero local server port (23119 by default). */
    port: number;
    /** Local API library id; `0` addresses the current local user library. */
    libraryId: string;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
}
export type QueryParams = Record<string, string | number | boolean | undefined>;
export interface ApiPage<T> {
    data: T;
    /** From the `Total-Results` response header; absent when Zotero does not send it. */
    total: number | undefined;
}
export interface ConnectorResponse {
    status: number;
    data: unknown;
    text: string;
}
export declare class ZoteroLocalClient {
    readonly options: ZoteroClientOptions;
    readonly base: string;
    private readonly headers;
    constructor(options: ZoteroClientOptions);
    private buildApiUrl;
    private raw;
    private readBody;
    /** GET one `/api/users/{libraryId}/…` JSON page. */
    api<T = unknown>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<ApiPage<T>>;
    /** GET one `/api/users/{libraryId}/…` page as raw text (bibtex / csljson export formats). */
    apiText(path: string, params?: QueryParams, signal?: AbortSignal): Promise<ApiPage<string>>;
    /**
     * Fetch every page of a list endpoint (100 per page, Zotero's page cap) up to `cap` rows.
     * Local API honors `Total-Results`, so termination is header-driven with a data-driven fallback.
     */
    apiAll(path: string, params: QueryParams, cap: number, signal?: AbortSignal): Promise<ApiPage<unknown[]>>;
    /** POST one `/connector/…` endpoint. `data` is parsed JSON when the body is JSON. */
    connector(path: string, body?: unknown, signal?: AbortSignal): Promise<ConnectorResponse>;
    /** Lightweight liveness probe of the connector server; never throws for "not running". */
    ping(signal?: AbortSignal): Promise<{
        running: boolean;
        version: string | undefined;
    }>;
}
