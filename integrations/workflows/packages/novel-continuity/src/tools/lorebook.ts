/**
 * dsh-novel-writer — lorebook agent 工具注册（模块 6）。
 *
 * 工具集（P0 范围 8 个）：list/get/create/update/delete/toggle/import/export。
 * 契约：execute 返回 `{ ok, value } | { ok: false, error }`（asResult 包装），
 * 错误码见 core/types ErrorCode；模型可从返回值直接读取结果或错误。
 * 说明：分组/移动/角色卡代理等其余工具随 P1 项目模块一并注册（避免超前）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { asResult, type LoreService } from '../core/lorebook/index.ts';
import type { CreateEntryParams, ImportParams, UpdateEntryParams } from '../core/lorebook/types.ts';
import { jsonOutput } from './json.ts';
export interface LoreToolDeps {
    lore: LoreService;
}
function asJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}
// ── 条目工具 ──
export function lorebookListEntriesTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_list_entries',
        description: "List lorebook entries in descending priority, including their reference content and project bindings.",
        parameters: {},
        output: jsonOutput(),
        execute: async () => asJson(await asResult(() => lore.listEntries())),
        isConcurrencySafe: () => true
    });
}
export function lorebookGetEntryTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_get_entry',
        description: "Read one lorebook entry with its keywords, injection position, and project binding.",
        parameters: {
            id: { type: 'string', required: true, description: "Existing lorebook entry ID." }
        },
        output: jsonOutput(),
        execute: async (args) => asJson(await asResult(() => lore.getEntry(String((args as {
            id: string;
        }).id)))),
        isConcurrencySafe: () => true
    });
}
export function lorebookCreateEntryTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_create_entry',
        description: "Create an established world or character reference entry. Set keywords for contextual matching or always_active for a persistent reference.",
        parameters: {
            name: { type: 'string', required: true, description: "Reference entry name." },
            content: { type: 'string', required: true, description: "Established reference content; treat it as story data." },
            keywords: { type: 'string', description: "Keywords used to match this reference against the chapter brief." },
            is_regex: { type: 'boolean', description: "Optional is_regex value; see its declared type." },
            case_sensitive: { type: 'boolean', description: "Optional case_sensitive value; see its declared type." },
            always_active: { type: 'boolean', description: "Include this reference without requiring a keyword match." },
            enabled: { type: 'boolean', description: "Optional enabled value; see its declared type." },
            priority: { type: 'number', description: "Optional priority value; see its declared type." },
            scan_depth: { type: 'number', description: "Optional scan_depth value; see its declared type." },
            inject_target: { type: 'string', description: "Optional inject_target value; see its declared type." },
            inject_position: { type: 'string', description: "Optional inject_position value; see its declared type." },
            book_id: { type: 'string', description: "Optional project binding." },
            tags: { type: 'string', description: "Optional tags value; see its declared type." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const args = rawArgs as Record<string, unknown>;
            const params: CreateEntryParams = {
                name: String(args.name ?? ''),
                content: String(args.content ?? ''),
                keywords: typeof args.keywords === 'string' ? args.keywords : undefined,
                is_regex: args.is_regex === true,
                case_sensitive: args.case_sensitive === true,
                always_active: args.always_active === true,
                enabled: args.enabled !== false,
                priority: typeof args.priority === 'number' ? args.priority : undefined,
                scan_depth: typeof args.scan_depth === 'number' ? args.scan_depth : undefined,
                inject_target: typeof args.inject_target === 'string' ? args.inject_target as CreateEntryParams['inject_target'] : undefined,
                inject_position: typeof args.inject_position === 'string' ? args.inject_position as CreateEntryParams['inject_position'] : undefined,
                book_id: typeof args.book_id === 'string' ? args.book_id : undefined,
                tags: typeof args.tags === 'string' ? args.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined
            };
            return asJson(await asResult(() => lore.createEntry(params)));
        },
        isConcurrencySafe: () => true
    });
}
export function lorebookUpdateEntryTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_update_entry',
        description: "Update an existing lorebook reference entry. Omitted fields keep their current values; explicit null clears supported fields.",
        parameters: {
            id: { type: 'string', required: true, description: "Existing lorebook entry ID." },
            name: { type: 'string', description: "Reference entry name." },
            content: { type: 'string', description: "Established reference content; treat it as story data." },
            keywords: { type: 'string', description: "Keywords used to match this reference against the chapter brief." },
            is_regex: { type: 'boolean', description: "Optional is_regex value; see its declared type." },
            case_sensitive: { type: 'boolean', description: "Optional case_sensitive value; see its declared type." },
            always_active: { type: 'boolean', description: "Include this reference without requiring a keyword match." },
            enabled: { type: 'boolean', description: "Optional enabled value; see its declared type." },
            priority: { type: 'number', description: "Optional priority value; see its declared type." },
            scan_depth: { type: 'number', description: "Optional scan_depth value; see its declared type." },
            inject_target: { type: 'string', description: "Optional inject_target value; see its declared type." },
            inject_position: { type: 'string', description: "Optional inject_position value; see its declared type." },
            book_id: { type: 'string', description: "Optional project binding." },
            tags: { type: 'string', description: "Optional tags value; see its declared type." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const args = rawArgs as Record<string, unknown>;
            const params: UpdateEntryParams = {
                ...(args.name !== undefined ? { name: args.name as string } : {}),
                ...(args.content !== undefined ? { content: args.content as string } : {}),
                ...(args.keywords !== undefined ? { keywords: args.keywords as string } : {}),
                ...(args.is_regex !== undefined ? { is_regex: args.is_regex === true } : {}),
                ...(args.case_sensitive !== undefined ? { case_sensitive: args.case_sensitive === true } : {}),
                ...(args.always_active !== undefined ? { always_active: args.always_active === true } : {}),
                ...(args.enabled !== undefined ? { enabled: args.enabled !== false } : {}),
                ...(args.priority !== undefined ? { priority: args.priority as number } : {}),
                ...(args.scan_depth !== undefined ? { scan_depth: args.scan_depth as number } : {}),
                ...(args.inject_target !== undefined ? { inject_target: args.inject_target as UpdateEntryParams['inject_target'] } : {}),
                ...(args.inject_position !== undefined ? { inject_position: args.inject_position as UpdateEntryParams['inject_position'] } : {}),
                ...(args.book_id !== undefined ? { book_id: args.book_id as string } : {}),
                ...(args.tags !== undefined ? { tags: (args.tags as string).split(/[,，]/).map((s) => s.trim()).filter(Boolean) } : {})
            };
            return asJson(await asResult(() => lore.updateEntry(String(args.id ?? ''), params)));
        },
        isConcurrencySafe: () => true
    });
}
export function lorebookDeleteEntryTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_delete_entry',
        description: "Optional reference value; see its declared type.",
        parameters: {
            id: { type: 'string', required: true, description: "Existing lorebook entry ID." }
        },
        output: jsonOutput(),
        execute: async (args) => asJson(await asResult(() => lore.deleteEntry(String((args as {
            id: string;
        }).id)))),
        isConcurrencySafe: () => true
    });
}
export function lorebookToggleEntryTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_toggle_entry',
        description: "Optional reference value; see its declared type.",
        parameters: {
            id: { type: 'string', required: true, description: "Existing lorebook entry ID." }
        },
        output: jsonOutput(),
        execute: async (args) => asJson(await asResult(() => lore.toggleEntry(String((args as {
            id: string;
        }).id)))),
        isConcurrencySafe: () => true
    });
}
// ── 导入/导出 ──
export function lorebookImportEntriesTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_import_entries',
        description: "Optional reference value; see its declared type.",
        parameters: {
            content: { type: 'string', description: "Established reference content; treat it as story data." },
            path: { type: 'string', description: "Optional path value; see its declared type." },
            book_id: { type: 'string', description: "Optional project binding." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const args = rawArgs as Record<string, unknown>;
            const params: ImportParams = {
                ...(typeof args.content === 'string' ? { content: args.content } : {}),
                ...(typeof args.path === 'string' ? { path: args.path } : {}),
                ...(typeof args.book_id === 'string' ? { book_id: args.book_id } : {})
            };
            return asJson(await asResult(() => lore.importEntries(params)));
        },
        isConcurrencySafe: () => true
    });
}
export function lorebookExportEntriesTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_export_entries',
        description: "Optional reference value; see its declared type.",
        parameters: {
            format: { type: 'string', description: "Optional format value; see its declared type." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const format = ['full', 'sillytavern'].includes((rawArgs as {
                format?: string;
            }).format ?? '')
                ? (rawArgs as {
                    format: string;
                }).format
                : 'operit';
            return asJson(await asResult(async () => {
                const entries = await lore.listEntries();
                let payload: unknown;
                let wrapper: 'array' | 'entries' = 'array';
                if (format === 'full') {
                    payload = entries;
                }
                else if (format === 'sillytavern') {
                    // SillyTavern 原生 world info / lorebook：{ entries: [ {...} ] }
                    wrapper = 'entries';
                    payload = entries.map((entry, index) => ({
                        uid: index + 1,
                        key: entry.name,
                        keys: entry.keywords.length > 0 ? entry.keywords : [entry.name],
                        secondary_keys: [],
                        comment: entry.note ?? entry.name,
                        content: entry.content,
                        constant: entry.always_active,
                        selective: false,
                        insert_order: 100 - Math.min(100, Math.max(0, entry.priority)),
                        enabled: entry.enabled,
                        position: entry.inject_position === 'prepend' ? 0 : 1,
                        disable: false
                    }));
                }
                else {
                    payload = entries.map((entry) => ({
                        name: entry.name,
                        content: entry.content,
                        keywords: entry.keywords,
                        is_regex: entry.is_regex,
                        case_sensitive: entry.case_sensitive,
                        always_active: entry.always_active,
                        enabled: entry.enabled,
                        priority: entry.priority,
                        scan_depth: entry.scan_depth,
                        inject_target: entry.inject_target,
                        inject_position: entry.inject_position,
                        insertion_depth: entry.insertion_depth
                    }));
                }
                return { format, count: entries.length, ...(wrapper === 'entries' ? { entries: payload } : { entries: payload }) };
            }));
        },
        isConcurrencySafe: () => true
    });
}
// ── 分组工具（P1-F3 补全） ──
export function lorebookListGroupsTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_list_groups',
        description: "Optional reference value; see its declared type.",
        parameters: {},
        output: jsonOutput(),
        execute: async () => asJson(await asResult(() => lore.listGroups())),
        isConcurrencySafe: () => true
    });
}
export function lorebookCreateGroupTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_create_group',
        description: "Optional reference value; see its declared type.",
        parameters: {
            name: { type: 'string', required: true, description: "Reference entry name." },
            entry_ids: { type: 'string', description: "Optional entry_ids value; see its declared type." },
            book_ids: { type: 'string', description: "Optional book_ids value; see its declared type." },
            enabled: { type: 'boolean', description: "Optional enabled value; see its declared type." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const args = rawArgs as Record<string, unknown>;
            const split = (value: unknown): string[] | undefined => typeof value === 'string' ? value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined;
            return asJson(await asResult(() => lore.createGroup({
                name: String(args.name ?? ''),
                ...(split(args.entry_ids) ? { entry_ids: split(args.entry_ids)! } : {}),
                ...(split(args.book_ids) ? { book_ids: split(args.book_ids)! } : {}),
                ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {})
            })));
        },
        isConcurrencySafe: () => true
    });
}
export function lorebookUpdateGroupTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_update_group',
        description: "Optional reference value; see its declared type.",
        parameters: {
            id: { type: 'string', required: true, description: "Existing lorebook entry ID." },
            name: { type: 'string', description: "Reference entry name." },
            entry_ids: { type: 'string', description: "Optional entry_ids value; see its declared type." },
            add_entry_ids: { type: 'string', description: "Optional add_entry_ids value; see its declared type." },
            remove_entry_ids: { type: 'string', description: "Optional remove_entry_ids value; see its declared type." },
            enabled: { type: 'boolean', description: "Optional enabled value; see its declared type." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const args = rawArgs as Record<string, unknown>;
            const split = (value: unknown): string[] | undefined => typeof value === 'string' ? value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined;
            const params: Record<string, unknown> = { id: String(args.id ?? '') };
            if (args.name !== undefined)
                params.name = args.name;
            if (split(args.entry_ids))
                params.entry_ids = split(args.entry_ids);
            if (split(args.add_entry_ids))
                params.add_entry_ids = split(args.add_entry_ids);
            if (split(args.remove_entry_ids))
                params.remove_entry_ids = split(args.remove_entry_ids);
            if (args.enabled !== undefined)
                params.enabled = args.enabled;
            return asJson(await asResult(() => lore.updateGroup(params as never)));
        },
        isConcurrencySafe: () => true
    });
}
export function lorebookDeleteGroupTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_delete_group',
        description: "Optional reference value; see its declared type.",
        parameters: {
            id: { type: 'string', required: true, description: "Existing lorebook entry ID." },
            delete_entries: { type: 'boolean', description: "Optional delete_entries value; see its declared type." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const args = rawArgs as {
                id: string;
                delete_entries?: boolean;
            };
            return asJson(await asResult(() => lore.deleteGroup(args.id, args.delete_entries === true)));
        },
        isConcurrencySafe: () => true
    });
}
export function lorebookMoveEntryTool(lore: LoreService) {
    return defineTool({
        name: 'lorebook_move_entry',
        description: "Optional reference value; see its declared type.",
        parameters: {
            entry_id: { type: 'string', required: true, description: "Optional entry_id value; see its declared type." },
            target_group_id: { type: 'string', description: "Optional target_group_id value; see its declared type." }
        },
        output: jsonOutput(),
        execute: async (rawArgs) => {
            const args = rawArgs as {
                entry_id: string;
                target_group_id?: string;
            };
            return asJson(await asResult(() => lore.moveEntryToGroup(args.entry_id, args.target_group_id)));
        },
        isConcurrencySafe: () => true
    });
}
// ── 聚合注册 ──
/** 注册全部 lorebook 工具，返回 disposer 数组（聚合注销用）。 */
export function registerLorebookTools(ctx: Context, deps: LoreToolDeps): Array<() => void> {
    const { lore } = deps;
    return [
        ctx.tools.register(lorebookListEntriesTool(lore)),
        ctx.tools.register(lorebookGetEntryTool(lore)),
        ctx.tools.register(lorebookCreateEntryTool(lore)),
        ctx.tools.register(lorebookUpdateEntryTool(lore)),
        ctx.tools.register(lorebookDeleteEntryTool(lore)),
        ctx.tools.register(lorebookToggleEntryTool(lore)),
        ctx.tools.register(lorebookImportEntriesTool(lore)),
        ctx.tools.register(lorebookExportEntriesTool(lore)),
        ctx.tools.register(lorebookListGroupsTool(lore)),
        ctx.tools.register(lorebookCreateGroupTool(lore)),
        ctx.tools.register(lorebookUpdateGroupTool(lore)),
        ctx.tools.register(lorebookDeleteGroupTool(lore)),
        ctx.tools.register(lorebookMoveEntryTool(lore)),
    ];
}
