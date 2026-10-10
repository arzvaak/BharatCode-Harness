import type { Context } from '@deepseek-ai/cordis';
import type { NovelService } from '../core/novel/service.ts';
export interface NovelToolDeps {
    novel: NovelService;
}
export declare function registerNovelDomainTools(ctx: Context, deps: NovelToolDeps): Array<() => void>;
