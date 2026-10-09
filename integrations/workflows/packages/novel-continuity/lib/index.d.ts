import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "novel-continuity";
export declare const inject: string[];
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    dataDir: Schema<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    dataDir: Schema<string, string, "defined">;
}>>, "plain">;
export declare function apply(ctx: Context, config: {
    dataDir: string;
}): void;
