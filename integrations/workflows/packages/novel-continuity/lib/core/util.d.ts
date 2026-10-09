export declare function newId(prefix: string): string;
export declare function nowIso(): string;
export declare function normalizeKeywords(raw: string | readonly string[] | undefined | null): string[];
export declare function normalizeNumber(value: unknown, fallback: number): number;
export declare function clampInt(value: number, min: number, max: number): number;
export declare function estimateTokens(text: string): number;
export declare function resolveAssetsDir(fromModuleUrl: string): string;
