import Schema from '@deepseek-ai/schemastery';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { LoreService, LoreStore } from "./core/lorebook/index.js";
import { NovelService, NovelStore } from "./core/novel/index.js";
import { VariableStoreFile, variablesFilePath } from "./core/variables/index.js";
import { registerNovelDomainTools } from "./tools/novel.js";
import { lorebookListEntriesTool, lorebookGetEntryTool, lorebookCreateEntryTool, lorebookUpdateEntryTool } from "./tools/lorebook.js";
export const name = 'novel-continuity';
export const inject = ['tools'];
export const Config = Schema.object({
    dataDir: Schema.string().default(join(homedir(), '.bharatcode', 'novel-continuity')).description('Directory for versioned writing projects, chapters, lorebook entries, and audit logs.')
});
export function apply(ctx, config) {
    const store = new NovelStore(join(config.dataDir, 'projects'));
    const loreStore = new LoreStore(join(config.dataDir, 'lorebook'));
    const novel = new NovelService({ store, loreStore, variables: new VariableStoreFile(variablesFilePath(join(config.dataDir, 'projects'))) });
    const lore = new LoreService(loreStore);
    registerNovelDomainTools(ctx, { novel });
    for (const tool of [lorebookListEntriesTool(lore), lorebookGetEntryTool(lore), lorebookCreateEntryTool(lore), lorebookUpdateEntryTool(lore)])
        ctx.tools.register(tool);
}
