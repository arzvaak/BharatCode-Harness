import Schema from '@deepseek-ai/schemastery';
import type { RuntimeConfig } from './types.js';
export declare const ConfigSchema: Schema<Schemastery.ObjectS<NoInfer<{
    timeoutMs: Schema<number, number, "defined">;
    chunkChars: Schema<number, number, "defined">;
    maxParts: Schema<number, number, "defined">;
    maxInputChars: Schema<number, number, "defined">;
    cacheEnabled: Schema<boolean, boolean, "defined">;
    cacheTtlHours: Schema<number, number, "defined">;
    estTokensPerSecond: Schema<number, number, "defined">;
    estLatencyPerCallMs: Schema<number, number, "defined">;
    backgroundMinChars: Schema<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    timeoutMs: Schema<number, number, "defined">;
    chunkChars: Schema<number, number, "defined">;
    maxParts: Schema<number, number, "defined">;
    maxInputChars: Schema<number, number, "defined">;
    cacheEnabled: Schema<boolean, boolean, "defined">;
    cacheTtlHours: Schema<number, number, "defined">;
    estTokensPerSecond: Schema<number, number, "defined">;
    estLatencyPerCallMs: Schema<number, number, "defined">;
    backgroundMinChars: Schema<number, number, "defined">;
}>>, "plain">;
export declare function resolveConfig(input: unknown): RuntimeConfig;
