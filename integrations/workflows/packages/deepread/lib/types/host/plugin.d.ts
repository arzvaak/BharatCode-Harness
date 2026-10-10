import type { Config as ConfigOptions } from './types.js';
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    chunkChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    maxParts: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    cacheEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    cacheTtlHours: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    estTokensPerSecond: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    estLatencyPerCallMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    backgroundMinChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    timeoutMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    chunkChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    maxParts: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    maxInputChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    cacheEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "defined">;
    cacheTtlHours: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    estTokensPerSecond: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    estLatencyPerCallMs: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    backgroundMinChars: import("@deepseek-ai/schemastery").default<number, number, "defined">;
}>>, "plain">;
export declare const name = "deepread";
export declare const inject: string[];
export declare function apply(ctx: unknown, config?: ConfigOptions): void;
