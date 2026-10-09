import { join } from 'node:path';
import { atomicWriteFile, readOptional } from "../atomic-file.js";
import { extractJsonPatchOperations } from "../variables/engine.js";
export const LEDGER_SCHEMA_VERSION = 1;
export class LedgerStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        const text = await readOptional(this.filePath);
        if (text === undefined)
            return [];
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw { code: 'INVALID_FIELD_TYPE', message: `ledger.json 损坏（非法 JSON）: ${this.filePath}` };
        }
        if (Array.isArray(parsed))
            return parsed;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
            return parsed.data;
        }
        throw { code: 'INVALID_FIELD_TYPE', message: `ledger.json 形状非法: ${this.filePath}` };
    }
    async save(entries) {
        await atomicWriteFile(this.filePath, `${JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION, data: entries }, null, 2)}\n`);
    }
    async all() {
        return await this.load();
    }
    async byEntity(entity) {
        const entries = await this.load();
        return entries.filter((entry) => entry.entity === entity);
    }
    async applyChapterPatch(bookId, chapterNo, chapterText) {
        const entries = await this.load();
        const withoutChapter = entries.filter((entry) => !(entry.source === `ch${chapterNo}`));
        const operations = extractJsonPatchOperations(chapterText);
        if (operations.length === 0) {
            if (withoutChapter.length !== entries.length)
                await this.save(withoutChapter);
            return 0;
        }
        const added = [];
        for (const op of operations) {
            if (op.op !== 'replace' && op.op !== 'insert')
                continue;
            const tokens = (op.path ?? '').split('/').filter(Boolean);
            const statRoot = tokens.findIndex((token) => token === 'stat_data');
            const rest = statRoot >= 0 ? tokens.slice(statRoot + 1) : tokens;
            if (rest.length < 2)
                continue;
            const [entity, ...fieldTokens] = rest;
            const field = fieldTokens.filter((token) => token !== '-').join('.') || 'value';
            const value = typeof op.value === 'object' ? JSON.stringify(op.value) : String(op.value ?? '');
            if (!entity)
                continue;
            added.push({
                entity,
                field,
                value,
                chapterNo,
                confidence: 'high',
                source: `ch${chapterNo}`,
            });
        }
        await this.save([...withoutChapter, ...added]);
        return added.length;
    }
    async record(entry, source) {
        const entries = await this.load();
        entries.push({ ...entry, source });
        await this.save(entries);
    }
    async clear() {
        await this.save([]);
    }
}
export class TimelineStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        const text = await readOptional(this.filePath);
        if (text === undefined)
            return [];
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw { code: 'INVALID_FIELD_TYPE', message: `timeline.json 损坏（非法 JSON）: ${this.filePath}` };
        }
        if (Array.isArray(parsed))
            return parsed;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.data)) {
            return parsed.data;
        }
        throw { code: 'INVALID_FIELD_TYPE', message: `timeline.json 形状非法: ${this.filePath}` };
    }
    async save(events) {
        await atomicWriteFile(this.filePath, `${JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION, data: events }, null, 2)}\n`);
    }
    async all() {
        return await this.load();
    }
    async record(event) {
        const events = await this.load();
        events.push({ ...event, createdAt: new Date().toISOString() });
        await this.save(events);
    }
}
export function ledgerFilePath(bookDir) {
    return join(bookDir, 'ledger.json');
}
export function timelineFilePath(bookDir) {
    return join(bookDir, 'timeline.json');
}
