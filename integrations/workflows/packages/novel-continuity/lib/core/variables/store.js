import { join } from 'node:path';
import { atomicWriteFile, readOptional } from "../atomic-file.js";
import { emptyVariableStore } from "./types.js";
import { applyPatchOperations, extractJsonPatchOperations } from "./engine.js";
export const VARIABLES_SCHEMA_VERSION = 1;
function freshBookState() {
    return { local_variables: {}, processed_chapter_numbers: [], last_scanned_chapter: 0 };
}
export class VariableStoreFile {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        const text = await readOptional(this.filePath);
        if (text === undefined)
            return emptyVariableStore();
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw { code: 'INVALID_FIELD_TYPE', message: `variables.json 损坏（非法 JSON）: ${this.filePath}` };
        }
        if (parsed && typeof parsed === 'object' && parsed.schemaVersion === VARIABLES_SCHEMA_VERSION
            && parsed.data && typeof parsed.data === 'object') {
            return parsed.data;
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !('schemaVersion' in parsed)) {
            return parsed;
        }
        throw { code: 'INVALID_FIELD_TYPE', message: `variables.json 形状非法: ${this.filePath}` };
    }
    async save(data) {
        const versioned = { schemaVersion: VARIABLES_SCHEMA_VERSION, data };
        await atomicWriteFile(this.filePath, `${JSON.stringify(versioned, null, 2)}\n`);
    }
    async applyChapterPatch(bookId, chapterNo, chapterText) {
        const data = await this.load();
        const state = data.books[bookId] ?? freshBookState();
        const operations = extractJsonPatchOperations(chapterText);
        const changed = operations.length > 0
            ? applyPatchOperations(state.local_variables, operations)
            : false;
        if (!state.processed_chapter_numbers.includes(chapterNo)) {
            state.processed_chapter_numbers = [...state.processed_chapter_numbers, chapterNo].sort((a, b) => a - b);
        }
        state.last_scanned_chapter = chapterNo;
        data.books[bookId] = state;
        await this.save(data);
        return changed;
    }
    async ensureBookVariables(bookId, initTemplate) {
        const data = await this.load();
        let dirty = false;
        const state = data.books[bookId] ?? freshBookState();
        if (!state.local_variables[DEFAULT_KEY] && initTemplate) {
            state.local_variables[DEFAULT_KEY] = JSON.parse(JSON.stringify(initTemplate));
            dirty = true;
        }
        if (!data.book_variables[bookId] && initTemplate) {
            data.book_variables[bookId] = JSON.parse(JSON.stringify(initTemplate));
            dirty = true;
        }
        if (dirty) {
            data.books[bookId] = state;
            await this.save(data);
        }
        return dirty;
    }
}
const DEFAULT_KEY = 'stat_data';
export function variablesFilePath(bookDir) {
    return join(bookDir, 'variables.json');
}
