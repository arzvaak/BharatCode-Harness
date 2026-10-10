import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nowIso } from "../util.js";
export const STORE_SCHEMA_VERSION = 1;
export const DEFAULT_BACKUP_KEEP = 5;
function ioError(path, cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { code: 'IO_FAILURE', message: `lorebook store 读写失败（${path}）: ${message}`, details: { path } };
}
function invalidShape(path, reason) {
    return { code: 'INVALID_FIELD_TYPE', message: `lorebook store 数据形状非法（${path}）: ${reason}`, details: { path } };
}
export function safeFileName(name) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name.includes('..')) {
        throw { code: 'INVALID_FIELD_TYPE', message: `非法存储文件名: ${name}` };
    }
    return name;
}
function migrateFile(raw, path) {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.schemaVersion === 'number') {
        const versioned = raw;
        if (versioned.schemaVersion === STORE_SCHEMA_VERSION)
            return versioned;
        throw invalidShape(path, `不支持的 schemaVersion=${versioned.schemaVersion}（当前 ${STORE_SCHEMA_VERSION}）`);
    }
    return { schemaVersion: STORE_SCHEMA_VERSION, data: raw };
}
async function pruneBackups(dir, stem, keep) {
    if (keep < 0)
        return;
    const entries = await readdir(dir).catch(() => []);
    const backups = entries
        .filter((name) => name.startsWith(`${stem}.bak.`))
        .sort();
    const excess = backups.length - keep;
    for (const name of backups.slice(0, excess)) {
        await rm(join(dir, name), { force: true }).catch(() => undefined);
    }
}
export class LoreStore {
    baseDir;
    keepBackups;
    constructor(baseDir, options = {}) {
        this.baseDir = baseDir;
        this.keepBackups = options.keepBackups ?? DEFAULT_BACKUP_KEEP;
    }
    async ensureDir() {
        await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    }
    filePath(stem) {
        return join(this.baseDir, safeFileName(`${stem}.json`));
    }
    async writeJsonAtomic(stem, content) {
        await this.ensureDir();
        const path = this.filePath(stem);
        try {
            const existing = await stat(path).catch(() => undefined);
            if (existing?.isFile()) {
                const backupPath = join(this.baseDir, `${safeFileName(stem)}.bak.${nowIso().replace(/[:.]/g, '-')}`);
                await copyFile(path, backupPath);
            }
            const temporary = join(this.baseDir, `${safeFileName(stem)}.tmp.${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
            await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
            await rename(temporary, path);
            await pruneBackups(this.baseDir, stem, this.keepBackups);
        }
        catch (error) {
            if (error?.code)
                throw error;
            throw ioError(path, error);
        }
    }
    async readJson(stem, fallback, validate) {
        await this.ensureDir();
        const path = this.filePath(stem);
        let text;
        try {
            text = await readFile(path, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return fallback;
            throw ioError(path, error);
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch (error) {
            throw invalidShape(path, `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
        }
        const versioned = migrateFile(parsed, path);
        return validate(versioned.data, path);
    }
    async readEntries() {
        return this.readJson('entries', [], (data, path) => {
            if (!Array.isArray(data))
                throw invalidShape(path, 'entries 必须是数组');
            for (const [index, item] of data.entries()) {
                if (item === null || typeof item !== 'object' || Array.isArray(item)) {
                    throw invalidShape(path, `entries[${index}] 必须是对象`);
                }
                const record = item;
                if (typeof record.id !== 'string' || !record.id) {
                    throw invalidShape(path, `entries[${index}].id 缺失或非字符串`);
                }
                if (typeof record.name !== 'string') {
                    throw invalidShape(path, `entries[${index}].name 缺失或非字符串`);
                }
                if (record.priority !== undefined && (typeof record.priority !== 'number' || !Number.isFinite(record.priority))) {
                    throw invalidShape(path, `entries[${index}].priority 非有限数字`);
                }
            }
            return data;
        });
    }
    async writeEntries(entries) {
        await this.writeVersioned('entries', entries);
    }
    async readGroups() {
        return this.readJson('groups', [], (data, path) => {
            if (!Array.isArray(data))
                throw invalidShape(path, 'groups 必须是数组');
            for (const [index, item] of data.entries()) {
                if (item === null || typeof item !== 'object' || Array.isArray(item)) {
                    throw invalidShape(path, `groups[${index}] 必须是对象`);
                }
                const record = item;
                if (typeof record.id !== 'string' || !record.id) {
                    throw invalidShape(path, `groups[${index}].id 缺失或非字符串`);
                }
                if (record.entry_ids !== undefined && !Array.isArray(record.entry_ids)) {
                    throw invalidShape(path, `groups[${index}].entry_ids 必须是数组`);
                }
            }
            return data;
        });
    }
    async writeGroups(groups) {
        await this.writeVersioned('groups', groups);
    }
    async readSettings() {
        return this.readJson('settings', {}, (data, path) => {
            if (data === null || typeof data !== 'object' || Array.isArray(data))
                throw invalidShape(path, 'settings 必须是对象');
            return data;
        });
    }
    async writeSettings(settings) {
        await this.writeVersioned('settings', settings);
    }
    async writeVersioned(stem, data) {
        const versioned = { schemaVersion: STORE_SCHEMA_VERSION, data };
        await this.writeJsonAtomic(stem, `${JSON.stringify(versioned, null, 2)}\n`);
    }
}
async function copyFile(source, destination) {
    const content = await readFile(source);
    await writeFile(destination, content, { mode: 0o600 });
}
