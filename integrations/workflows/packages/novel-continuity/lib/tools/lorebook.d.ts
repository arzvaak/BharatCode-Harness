import type { Context } from '@deepseek-ai/cordis';
import { type LoreService } from '../core/lorebook/index.ts';
export interface LoreToolDeps {
    lore: LoreService;
}
export declare function lorebookListEntriesTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookGetEntryTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookCreateEntryTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookUpdateEntryTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookDeleteEntryTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookToggleEntryTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookImportEntriesTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookExportEntriesTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookListGroupsTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookCreateGroupTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookUpdateGroupTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookDeleteGroupTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function lorebookMoveEntryTool(lore: LoreService): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function registerLorebookTools(ctx: Context, deps: LoreToolDeps): Array<() => void>;
