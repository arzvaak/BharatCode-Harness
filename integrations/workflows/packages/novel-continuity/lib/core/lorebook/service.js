import { readFile as fsReadFile } from 'node:fs/promises';
import { clampInt, newId, normalizeKeywords, normalizeNumber, nowIso } from "../util.js";
function error(code, message) {
    return { code, message };
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function requireString(record, key, label) {
    const value = record[key];
    if (typeof value !== 'string')
        throw error('INVALID_FIELD_TYPE', `${label} 必须是字符串`);
    return value.trim();
}
function optionalBoolean(record, key, fallback) {
    const value = record[key];
    if (value == null)
        return fallback;
    if (typeof value !== 'boolean')
        throw error('INVALID_FIELD_TYPE', `${key} 必须是布尔值`);
    return value;
}
function optionalNumber(record, key, fallback) {
    const value = record[key];
    if (value == null)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw error('INVALID_FIELD_TYPE', `${key} 必须是数字`);
    return value;
}
function optionalKeywords(record, key, label) {
    const value = record[key];
    if (value == null)
        return [];
    if (Array.isArray(value)) {
        return value.map((item) => {
            if (typeof item !== 'string')
                throw error('INVALID_FIELD_TYPE', `${label} 必须是字符串数组`);
            return item.trim();
        }).filter((item) => item.length > 0);
    }
    if (typeof value === 'string')
        return normalizeKeywords(value);
    throw error('INVALID_FIELD_TYPE', `${label} 必须是字符串数组`);
}
export function normalizeInjectTarget(value) {
    if (value === 'user')
        return 'user';
    if (value === 'assistant')
        return 'assistant';
    return 'system';
}
export function normalizeInjectPosition(value) {
    if (value === 'prepend')
        return 'prepend';
    if (value === 'at_depth')
        return 'at_depth';
    return 'append';
}
function addWarning(warnings, warning) {
    if (!warnings.includes(warning))
        warnings.push(warning);
}
function templateCompatibilityWarnings(content, warnings) {
    if (/\{\{\s*get_preset_variable::/i.test(content)) {
        addWarning(warnings, '导入源包含酒馆助手的 preset 变量读取宏，宿主未暴露该上下文，语法保留原文。');
    }
    if (/\{\{\s*format_preset_variable::/i.test(content)) {
        addWarning(warnings, '导入源包含酒馆助手的 preset 变量格式化宏，宿主未暴露该上下文，语法保留原文。');
    }
    if (/\{\{\s*(?:set|inc|dec)(?:global)?var::/i.test(content)) {
        addWarning(warnings, '导入源包含会修改变量的 SillyTavern 宏；本插件只解析 <UpdateVariable>/<JSONPatch>。');
    }
    if (/\{\{\s*[.$][A-Za-z][A-Za-z0-9_-]*\s*(?:\+\+|--|\+=|-=|\|\|=?|\?\?=?|==|!=|>=|<=|>|<|=)[^}]*\}\}/.test(content)) {
        addWarning(warnings, '导入源包含带运算/赋值的变量简写表达式；仅支持只读写法（{{.var}}/{{$var}}）。');
    }
}
function resolveCharacterBookRoleTarget(rawRole, warnings) {
    if (rawRole == null || rawRole === 0 || rawRole === 'system')
        return 'system';
    if (rawRole === 1 || rawRole === 'user')
        return 'user';
    if (rawRole === 2 || rawRole === 'assistant' || rawRole === 'char')
        return 'assistant';
    addWarning(warnings, `角色卡世界书包含未识别的 role 值 ${String(rawRole)}，已按 system 注入处理。`);
    return 'system';
}
function resolvePlacement(rawEntry, extensions, warnings) {
    const position = typeof rawEntry.position === 'string' ? rawEntry.position.trim().toLowerCase() : '';
    const roleValue = 'role' in rawEntry ? rawEntry.role : extensions.role;
    const depthValue = 'depth' in rawEntry ? rawEntry.depth : extensions.depth;
    switch (position) {
        case '':
        case 'after_char':
            return { inject_target: 'system', inject_position: 'append', insertion_depth: 0 };
        case 'before_char':
            return { inject_target: 'system', inject_position: 'prepend', insertion_depth: 0 };
        case 'top_an':
            addWarning(warnings, '角色卡世界书位置 top_an 已近似映射为系统提示词顶部插入。');
            return { inject_target: 'system', inject_position: 'prepend', insertion_depth: 0 };
        case 'bottom_an':
        case 'after_examples':
            addWarning(warnings, `角色卡世界书位置 ${position} 已近似映射为系统提示词尾部插入。`);
            return { inject_target: 'system', inject_position: 'append', insertion_depth: 0 };
        case 'at_depth':
        case 'in_chat':
            return {
                inject_target: resolveCharacterBookRoleTarget(roleValue, warnings),
                inject_position: 'at_depth',
                insertion_depth: normalizeNumber(depthValue, 0),
            };
        default:
            addWarning(warnings, `角色卡世界书位置 ${position} 未精确支持，已按系统提示词尾部插入。`);
            return { inject_target: 'system', inject_position: 'append', insertion_depth: 0 };
    }
}
function parseOperitArray(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        return null;
    const warnings = [];
    const entries = [];
    for (const item of raw) {
        if (!isRecord(item))
            continue;
        const name = requireString(item, 'name', 'Operit 条目 name');
        const content = requireString(item, 'content', 'Operit 条目 content');
        if (!name || !content)
            continue;
        entries.push({
            name,
            content,
            keywords: optionalKeywords(item, 'keywords', 'Operit 条目 keywords'),
            is_regex: optionalBoolean(item, 'is_regex', false),
            case_sensitive: optionalBoolean(item, 'case_sensitive', false),
            always_active: optionalBoolean(item, 'always_active', false),
            enabled: optionalBoolean(item, 'enabled', true),
            priority: optionalNumber(item, 'priority', 50),
            scan_depth: optionalNumber(item, 'scan_depth', 0),
            inject_target: normalizeInjectTarget(item.inject_target),
            inject_position: normalizeInjectPosition(item.inject_position),
            insertion_depth: optionalNumber(item, 'insertion_depth', 0),
        });
    }
    if (entries.length === 0)
        return null;
    return { sourceType: 'operit_entries', warnings, entries };
}
function parseSillyTavernRecord(rawEntry, warnings) {
    const name = typeof rawEntry.name === 'string'
        ? rawEntry.name.trim()
        : typeof rawEntry.comment === 'string'
            ? rawEntry.comment.trim()
            : typeof rawEntry.id === 'string'
                ? rawEntry.id.trim()
                : '';
    const content = requireString(rawEntry, 'content', 'SillyTavern 条目 content');
    if (!content)
        return null;
    templateCompatibilityWarnings(content, warnings);
    const keywords = optionalKeywords(rawEntry, 'key', 'SillyTavern 条目 key');
    const alwaysActive = optionalBoolean(rawEntry, 'constant', false);
    if (keywords.length === 0 && !alwaysActive) {
        addWarning(warnings, '部分条目没有可导入的主关键词，且不是常驻条目，已跳过。');
        return null;
    }
    const fallbackName = keywords[0]
        ?? (typeof rawEntry.uid === 'string' || typeof rawEntry.uid === 'number' ? String(rawEntry.uid) : '');
    const resolvedName = name || fallbackName || '未命名条目';
    const secondaryKeys = optionalKeywords(rawEntry, 'keysecondary', 'SillyTavern 条目 keysecondary');
    if (secondaryKeys.length > 0)
        addWarning(warnings, '导入源包含次级关键词 keysecondary，当前版本未原样支持，已忽略。');
    if (optionalBoolean(rawEntry, 'selective', false))
        addWarning(warnings, '导入源包含 selective 逻辑，已按主关键词导入。');
    if (rawEntry.role != null)
        addWarning(warnings, '导入源包含额外注入位置字段 role，已按系统提示词导入。');
    return {
        name: resolvedName,
        content,
        keywords,
        is_regex: optionalBoolean(rawEntry, 'use_regex', false),
        case_sensitive: optionalBoolean(rawEntry, 'caseSensitive', false),
        always_active: alwaysActive,
        enabled: !optionalBoolean(rawEntry, 'disable', false),
        priority: 'display_index' in rawEntry
            ? optionalNumber(rawEntry, 'display_index', 50)
            : optionalNumber(rawEntry, 'order', 50),
        scan_depth: 'scanDepth' in rawEntry
            ? optionalNumber(rawEntry, 'scanDepth', 0)
            : optionalNumber(rawEntry, 'depth', 0),
        inject_target: 'system',
        inject_position: 'append',
        insertion_depth: 0,
    };
}
function parseSillyTavernWorldBook(raw) {
    if (!isRecord(raw) || !isRecord(raw.entries))
        return null;
    const warnings = [];
    const entries = [];
    for (const item of Object.values(raw.entries)) {
        if (!isRecord(item))
            continue;
        const parsed = parseSillyTavernRecord(item, warnings);
        if (parsed)
            entries.push(parsed);
    }
    if (entries.length === 0)
        return null;
    entries.sort((a, b) => b.priority - a.priority);
    return { sourceType: 'sillytavern_worldbook', warnings, entries };
}
function parseCharacterBookEntry(rawEntry, warnings) {
    const name = typeof rawEntry.comment === 'string'
        ? rawEntry.comment.trim()
        : typeof rawEntry.name === 'string'
            ? rawEntry.name.trim()
            : typeof rawEntry.id === 'string'
                ? rawEntry.id.trim()
                : '';
    const content = requireString(rawEntry, 'content', 'character_book 条目 content');
    if (!content)
        return null;
    templateCompatibilityWarnings(content, warnings);
    const keywords = optionalKeywords(rawEntry, 'keys', 'character_book 条目 keys');
    const alwaysActive = optionalBoolean(rawEntry, 'constant', false);
    if (keywords.length === 0 && !alwaysActive) {
        addWarning(warnings, '部分角色卡世界书条目没有主关键词，且不是常驻条目，已跳过。');
        return null;
    }
    const resolvedName = name || keywords[0] || '未命名条目';
    const secondaryKeys = optionalKeywords(rawEntry, 'secondary_keys', 'character_book 条目 secondary_keys');
    if (secondaryKeys.length > 0)
        addWarning(warnings, '角色卡世界书包含 secondary_keys，当前版本未原样支持，已忽略。');
    if (optionalBoolean(rawEntry, 'selective', false))
        addWarning(warnings, '角色卡世界书包含 selective 逻辑，已按主关键词导入。');
    const extensions = isRecord(rawEntry.extensions) ? rawEntry.extensions : {};
    const placement = resolvePlacement(rawEntry, extensions, warnings);
    return {
        name: resolvedName,
        content,
        keywords,
        is_regex: optionalBoolean(rawEntry, 'use_regex', false),
        case_sensitive: optionalBoolean(extensions, 'case_sensitive', false),
        always_active: alwaysActive,
        enabled: optionalBoolean(rawEntry, 'enabled', true),
        priority: optionalNumber(rawEntry, 'insertion_order', 50),
        scan_depth: optionalNumber(extensions, 'depth', 0),
        inject_target: placement.inject_target,
        inject_position: placement.inject_position,
        insertion_depth: placement.insertion_depth,
    };
}
function parseCharacterBook(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.entries))
        return null;
    const warnings = [];
    const entries = [];
    for (const item of raw.entries) {
        if (!isRecord(item))
            continue;
        const parsed = parseCharacterBookEntry(item, warnings);
        if (parsed)
            entries.push(parsed);
    }
    if (entries.length === 0)
        return null;
    entries.sort((a, b) => b.priority - a.priority);
    return { sourceType: 'character_book', warnings, entries };
}
function parseImportedPayload(raw) {
    const operit = parseOperitArray(raw);
    if (operit)
        return operit;
    if (!isRecord(raw))
        throw error('INVALID_WORLD_BOOK_JSON', '导入文件不是有效的世界书 JSON 结构');
    const embeddedCharacterBook = isRecord(raw.character_book) ? parseCharacterBook(raw.character_book) : null;
    if (embeddedCharacterBook)
        return embeddedCharacterBook;
    const originalData = isRecord(raw.originalData) ? raw.originalData : null;
    if (originalData) {
        const originalCharacterBook = parseCharacterBook(originalData);
        if (originalCharacterBook)
            return originalCharacterBook;
        const originalWorldBook = parseSillyTavernWorldBook(originalData);
        if (originalWorldBook)
            return originalWorldBook;
    }
    const worldBook = parseSillyTavernWorldBook(raw);
    if (worldBook)
        return worldBook;
    const characterBook = parseCharacterBook(raw);
    if (characterBook)
        return characterBook;
    throw error('UNSUPPORTED_WORLD_BOOK_FORMAT', '暂不支持该世界书格式（支持 Operit 数组、SillyTavern lorebook、角色卡内嵌 character_book）');
}
export class LoreService {
    store;
    readExternalFile;
    constructor(store, readExternalFile = async (path) => fsReadFile(path, 'utf8')) {
        this.store = store;
        this.readExternalFile = readExternalFile;
    }
    async listEntries() {
        const entries = await this.store.readEntries();
        return [...entries].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    }
    async getEntry(id) {
        const normalized = String(id ?? '').trim();
        if (!normalized)
            throw error('INVALID_ENTRY_ID', '条目 ID 不能为空');
        const entries = await this.store.readEntries();
        const found = entries.find((entry) => entry.id === normalized);
        if (!found)
            throw error('ENTRY_NOT_FOUND', `条目不存在: ${normalized}`);
        return found;
    }
    async createEntry(params) {
        const name = String(params.name ?? '').trim();
        const content = String(params.content ?? '').trim();
        if (!name || !content)
            throw error('INVALID_FIELD_TYPE', '条目 name 与 content 不能为空');
        const injectTarget = normalizeInjectTarget(params.inject_target);
        const entry = {
            id: newId('wb'),
            name,
            content,
            keywords: normalizeKeywords(params.keywords),
            is_regex: params.is_regex === true,
            case_sensitive: params.case_sensitive === true,
            always_active: params.always_active === true,
            enabled: params.enabled !== false,
            priority: clampInt(normalizeNumber(params.priority, 50), 0, 1000),
            scan_depth: clampInt(normalizeNumber(params.scan_depth, 0), 0, 100),
            inject_target: injectTarget,
            inject_position: injectTarget === 'assistant' ? 'at_depth' : normalizeInjectPosition(params.inject_position),
            insertion_depth: clampInt(normalizeNumber(params.insertion_depth, 0), 0, 1000),
            book_id: String(params.book_id ?? '').trim(),
            ...(params.volume_id !== undefined ? { volume_id: String(params.volume_id).trim() || undefined } : {}),
            tags: params.tags ?? [],
            ...(params.note !== undefined ? { note: String(params.note) } : {}),
            version: 1,
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        const entries = await this.store.readEntries();
        entries.push(entry);
        await this.store.writeEntries(entries);
        return entry;
    }
    async updateEntry(id, params) {
        const entries = await this.store.readEntries();
        const index = entries.findIndex((entry) => entry.id === String(id ?? '').trim());
        if (index === -1)
            throw error('ENTRY_NOT_FOUND', `条目不存在: ${id}`);
        const current = entries[index];
        const next = { ...current };
        if (params.name !== undefined)
            next.name = String(params.name ?? '').trim();
        if (params.content !== undefined)
            next.content = String(params.content ?? '');
        if (params.keywords !== undefined)
            next.keywords = normalizeKeywords(params.keywords);
        if (params.book_id !== undefined)
            next.book_id = String(params.book_id ?? '').trim();
        if (params.volume_id !== undefined)
            next.volume_id = String(params.volume_id ?? '').trim() || undefined;
        if (params.tags !== undefined)
            next.tags = params.tags ?? [];
        if (params.note !== undefined)
            next.note = params.note ?? undefined;
        if (params.is_regex != null)
            next.is_regex = params.is_regex === true;
        if (params.case_sensitive != null)
            next.case_sensitive = params.case_sensitive === true;
        if (params.always_active != null)
            next.always_active = params.always_active === true;
        if (params.enabled != null)
            next.enabled = params.enabled !== false;
        if (params.priority != null)
            next.priority = clampInt(normalizeNumber(params.priority, next.priority), 0, 1000);
        if (params.scan_depth != null)
            next.scan_depth = clampInt(normalizeNumber(params.scan_depth, next.scan_depth), 0, 100);
        if (params.inject_target != null)
            next.inject_target = normalizeInjectTarget(params.inject_target);
        if (params.inject_position != null)
            next.inject_position = normalizeInjectPosition(params.inject_position);
        if (params.insertion_depth != null)
            next.insertion_depth = clampInt(normalizeNumber(params.insertion_depth, next.insertion_depth ?? 0), 0, 1000);
        if (params.book_id != null)
            next.book_id = String(params.book_id).trim();
        if (params.volume_id != null)
            next.volume_id = String(params.volume_id).trim() || undefined;
        if (params.tags != null)
            next.tags = params.tags;
        if (params.note != null)
            next.note = params.note;
        if (next.inject_target === 'assistant')
            next.inject_position = 'at_depth';
        next.version = current.version + 1;
        next.updated_at = nowIso();
        entries[index] = next;
        await this.store.writeEntries(entries);
        return next;
    }
    async deleteEntry(id) {
        const entries = await this.store.readEntries();
        const index = entries.findIndex((entry) => entry.id === String(id ?? '').trim());
        if (index === -1)
            throw error('ENTRY_NOT_FOUND', `条目不存在: ${id}`);
        const [removed] = entries.splice(index, 1);
        await this.store.writeEntries(entries);
        const groups = await this.store.readGroups();
        let dirty = false;
        for (const group of groups) {
            const before = group.entry_ids.length;
            group.entry_ids = group.entry_ids.filter((entryId) => entryId !== removed.id);
            if (group.entry_ids.length !== before) {
                group.updated_at = nowIso();
                dirty = true;
            }
        }
        if (dirty)
            await this.store.writeGroups(groups);
        return removed;
    }
    async toggleEntry(id) {
        const entries = await this.store.readEntries();
        const index = entries.findIndex((entry) => entry.id === String(id ?? '').trim());
        if (index === -1)
            throw error('ENTRY_NOT_FOUND', `条目不存在: ${id}`);
        const current = entries[index];
        const next = { ...current, enabled: !current.enabled, version: current.version + 1, updated_at: nowIso() };
        entries[index] = next;
        await this.store.writeEntries(entries);
        return next;
    }
    async importEntries(params) {
        let sourceContent = String(params.content ?? '').trim();
        if (!sourceContent) {
            const path = String(params.path ?? '').trim();
            if (!path)
                throw error('IMPORT_PATH_REQUIRED', '导入路径不能为空');
            try {
                sourceContent = (await this.readExternalFile(path)).trim();
            }
            catch (cause) {
                throw error('IO_FAILURE', `读取导入文件失败: ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
            }
            if (!sourceContent)
                throw error('IMPORT_FILE_EMPTY', '导入文件为空');
        }
        let parsedJson;
        try {
            parsedJson = JSON.parse(sourceContent);
        }
        catch (cause) {
            throw error('INVALID_JSON', `导入文件不是有效的 JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        const payload = parseImportedPayload(parsedJson);
        if (payload.entries.length === 0)
            throw error('NO_IMPORTABLE_ENTRIES', '没有可导入的世界书条目');
        const bookId = String(params.book_id ?? '').trim();
        const now = nowIso();
        const imported = payload.entries.map((item) => ({
            id: newId('wb'),
            name: item.name,
            content: item.content,
            keywords: item.keywords,
            is_regex: item.is_regex,
            case_sensitive: item.case_sensitive,
            always_active: item.always_active,
            enabled: item.enabled,
            priority: clampInt(item.priority, 0, 1000),
            scan_depth: clampInt(item.scan_depth, 0, 100),
            inject_target: item.inject_target,
            inject_position: item.inject_position,
            insertion_depth: clampInt(item.insertion_depth, 0, 1000),
            book_id: bookId,
            tags: [],
            version: 1,
            created_at: now,
            updated_at: now,
        }));
        const entries = await this.store.readEntries();
        entries.push(...imported);
        await this.store.writeEntries(entries);
        return {
            source_type: payload.sourceType,
            imported_count: imported.length,
            warning_count: payload.warnings.length,
            warnings: payload.warnings,
            entries: imported,
        };
    }
    async listGroups() {
        const groups = await this.store.readGroups();
        return [...groups].sort((a, b) => a.name.localeCompare(b.name));
    }
    async createGroup(params) {
        const now = nowIso();
        const group = {
            id: newId('wg'),
            name: String(params.name ?? '').trim() || '未命名分组',
            entry_ids: params.entry_ids ?? [],
            book_ids: params.book_ids ?? [],
            enabled: params.enabled !== false,
            created_at: now,
            updated_at: now,
        };
        const groups = await this.store.readGroups();
        groups.push(group);
        await this.store.writeGroups(groups);
        return group;
    }
    async updateGroup(params) {
        const groups = await this.store.readGroups();
        const index = groups.findIndex((group) => group.id === String(params.id ?? '').trim());
        if (index === -1)
            throw error('GROUP_NOT_FOUND', '分组不存在');
        const group = groups[index];
        if (params.name != null)
            group.name = String(params.name).trim() || group.name;
        if (params.entry_ids != null)
            group.entry_ids = params.entry_ids;
        if (params.add_entry_ids != null) {
            for (const id of params.add_entry_ids) {
                if (!group.entry_ids.includes(id))
                    group.entry_ids.push(id);
            }
        }
        if (params.remove_entry_ids != null) {
            group.entry_ids = group.entry_ids.filter((id) => !params.remove_entry_ids.includes(id));
        }
        if (params.book_ids != null)
            group.book_ids = params.book_ids;
        if (params.enabled != null)
            group.enabled = params.enabled;
        group.updated_at = nowIso();
        await this.store.writeGroups(groups);
        return group;
    }
    async deleteGroup(id, deleteEntries) {
        const groups = await this.store.readGroups();
        const index = groups.findIndex((group) => group.id === String(id ?? '').trim());
        if (index === -1)
            throw error('GROUP_NOT_FOUND', '分组不存在');
        const [removedGroup] = groups.splice(index, 1);
        await this.store.writeGroups(groups);
        let removedEntries = [];
        if (deleteEntries) {
            const entries = await this.store.readEntries();
            const remaining = [];
            for (const entry of entries) {
                if (removedGroup.entry_ids.includes(entry.id))
                    removedEntries.push(entry);
                else
                    remaining.push(entry);
            }
            await this.store.writeEntries(remaining);
        }
        return { removedGroup: removedGroup, removedEntries };
    }
    async moveEntryToGroup(entryId, targetGroupId) {
        const normalizedEntryId = String(entryId ?? '').trim();
        if (!normalizedEntryId)
            throw error('INVALID_ENTRY_ID', '条目 ID 不能为空');
        const groups = await this.store.readGroups();
        const now = nowIso();
        const removedFrom = [];
        for (const group of groups) {
            if (group.entry_ids.includes(normalizedEntryId)) {
                group.entry_ids = group.entry_ids.filter((id) => id !== normalizedEntryId);
                group.updated_at = now;
                removedFrom.push(group.id);
            }
        }
        let targetGroup = null;
        if (targetGroupId) {
            const target = groups.find((group) => group.id === String(targetGroupId).trim());
            if (!target)
                throw error('GROUP_NOT_FOUND', '目标分组不存在');
            if (!target.entry_ids.includes(normalizedEntryId)) {
                target.entry_ids.push(normalizedEntryId);
                target.updated_at = now;
            }
            targetGroup = target;
        }
        await this.store.writeGroups(groups);
        return { removedFrom, targetGroup };
    }
}
function englishError(code) {
    const messages = { INVALID_FIELD_TYPE: 'Invalid field value or stored data. Check the supplied types and project files.', INVALID_ENTRY_ID: 'Invalid project or lorebook entry ID.', ENTRY_NOT_FOUND: 'The requested project or lorebook entry does not exist.', GROUP_NOT_FOUND: 'The requested lorebook group does not exist.', INVALID_STATE: 'This workflow transition is blocked. Complete or approve the prerequisite phase first.', IO_FAILURE: 'The project data could not be read or written.' };
    return messages[code] ?? 'The operation failed. Check the stable error code and supplied arguments.';
}
export async function asResult(body) {
    try {
        return { ok: true, value: await body() };
    }
    catch (cause) {
        if (isRecord(cause) && typeof cause.code === 'string' && typeof cause.message === 'string') {
            return { ok: false, error: { code: cause.code, message: englishError(cause.code) } };
        }
        return { ok: false, error: { code: 'IO_FAILURE', message: cause instanceof Error ? cause.message : String(cause) } };
    }
}
