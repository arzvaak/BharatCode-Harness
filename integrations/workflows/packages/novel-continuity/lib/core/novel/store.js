import { join } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { appendLine, atomicWriteFile, readOptional } from "../atomic-file.js";
import { newId, nowIso } from "../util.js";
import { createLedger, PHASE_ORDER } from "../workflow/engine.js";
export const BOOK_SCHEMA_VERSION = 1;
export function assertBookId(id) {
    const normalized = String(id ?? '').trim();
    if (!/^bk_[a-z0-9._-]+$/i.test(normalized) || normalized.includes('..')) {
        throw { code: 'INVALID_ENTRY_ID', message: `非法项目 ID: ${normalized}` };
    }
    return normalized;
}
function defaultConfig(genre) {
    return {
        title: '',
        genre,
        wordTargets: { perChapterMin: 2000, perChapterMax: 4000 },
        style: { pov: 'third', forbiddenWords: [], aiTasteWords: [] },
        phaseGating: true,
    };
}
function toSummary(book) {
    return {
        id: book.id,
        title: book.title,
        genre: book.genre,
        status: book.status,
        currentPhase: book.currentPhase,
        chapterCount: book.stats.chapterCount,
        totalWords: book.stats.totalWords,
        updatedAt: book.updatedAt,
    };
}
export function encodeChapterFrontmatter(chapter) {
    return `<!-- novel: ${JSON.stringify(chapter)} -->\n`;
}
export function parseChapterFrontmatter(text) {
    const firstLineEnd = text.indexOf('\n');
    const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
    const match = /^<!--\s*novel:\s*(\{.*\})\s*-->$/.exec(firstLine.trim());
    if (!match)
        return null;
    try {
        const raw = JSON.parse(match[1] ?? '{}');
        const chapter = {
            no: typeof raw.no === 'number' ? raw.no : 0,
            title: typeof raw.title === 'string' ? raw.title : '',
            status: raw.status === 'approved' || raw.status === 'revised' ? raw.status : 'draft',
            version: typeof raw.version === 'number' ? raw.version : 1,
            words: typeof raw.words === 'number' ? raw.words : 0,
            ...(typeof raw.brief === 'string' ? { brief: raw.brief } : {}),
            createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        };
        const body = firstLineEnd === -1 ? '' : text.slice(firstLineEnd + 1);
        return { chapter, body };
    }
    catch {
        return null;
    }
}
export class NovelStore {
    baseDir;
    constructor(baseDir) {
        this.baseDir = baseDir;
    }
    bookDir(id) {
        return join(this.baseDir, assertBookId(id));
    }
    getBookDir(id) {
        return this.bookDir(id);
    }
    bookFile(id) {
        return join(this.bookDir(id), 'book.json');
    }
    async createBook(params) {
        const id = newId('bk');
        const now = nowIso();
        const genre = params.genre.trim() || 'fantasy';
        const config = defaultConfig(genre);
        config.title = params.title.trim();
        const ledger = createLedger(id, now);
        const book = {
            id,
            title: params.title.trim(),
            genre,
            status: 'drafting',
            config,
            phases: ledger.phases,
            currentPhase: ledger.currentPhase,
            stats: { totalWords: 0, chapterCount: 0 },
            createdAt: now,
            updatedAt: now,
            schemaVersion: BOOK_SCHEMA_VERSION,
        };
        await mkdir(this.bookDir(id), { recursive: true, mode: 0o700 });
        await atomicWriteFile(this.bookFile(id), `${JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, data: book }, null, 2)}\n`);
        await appendLine(join(this.bookDir(id), 'audit.jsonl'), `${JSON.stringify({ seq: 1, at: now, action: 'create', phase: 'topic', actor: 'user', detail: 'project created' })}`);
        return book;
    }
    async loadBook(id) {
        const text = await readOptional(this.bookFile(id));
        if (text === undefined)
            throw { code: 'ENTRY_NOT_FOUND', message: `项目不存在: ${id}` };
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw { code: 'INVALID_FIELD_TYPE', message: `book.json 损坏（非法 JSON）: ${id}` };
        }
        const raw = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.schemaVersion === 'number'
            ? parsed.data
            : parsed;
        if (!raw || typeof raw.id !== 'string' || !raw.phases || typeof raw.config !== 'object' || typeof raw.stats !== 'object') {
            throw { code: 'INVALID_FIELD_TYPE', message: `book.json 形状非法: ${id}` };
        }
        const phases = { ...raw.phases };
        for (const phaseId of PHASE_ORDER) {
            if (!phases[phaseId])
                phases[phaseId] = { id: phaseId, state: 'locked', version: 0 };
        }
        return { ...raw, phases, schemaVersion: BOOK_SCHEMA_VERSION };
    }
    async saveBook(book) {
        const saved = { ...book, updatedAt: nowIso() };
        await atomicWriteFile(this.bookFile(book.id), `${JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, data: saved }, null, 2)}\n`);
    }
    async listBooks() {
        const names = await readdir(this.baseDir).catch(() => []);
        const summaries = [];
        for (const name of names) {
            if (!/^bk_[a-z0-9._-]+$/i.test(name))
                continue;
            try {
                summaries.push(toSummary(await this.loadBook(name)));
            }
            catch {
            }
        }
        return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    async deleteProject(id, keepChapters) {
        const dir = this.bookDir(id);
        const { rm } = await import('node:fs/promises');
        if (keepChapters) {
            await rm(this.bookFile(id), { force: true });
            await rm(join(dir, 'docs'), { recursive: true, force: true });
            await rm(join(dir, 'versions'), { recursive: true, force: true });
            await rm(join(dir, 'summary'), { recursive: true, force: true });
            await rm(join(dir, 'exports'), { recursive: true, force: true });
            await rm(join(dir, 'audit.jsonl'), { force: true });
            await rm(join(dir, 'ledger.json'), { force: true });
            await rm(join(dir, 'timeline.json'), { force: true });
            await rm(join(dir, 'variables.json'), { force: true });
            await rm(join(dir, 'wizard.json'), { force: true });
            await rm(join(dir, 'foreshadow.json'), { force: true });
            await rm(join(dir, 'glossary.json'), { force: true });
            await rm(join(dir, 'ideas.json'), { force: true });
            return { deleted: true, keptChapters: true };
        }
        await rm(dir, { recursive: true, force: true });
        return { deleted: true, keptChapters: false };
    }
    async appendAudit(bookId, event) {
        const path = join(this.bookDir(bookId), 'audit.jsonl');
        const existing = await readOptional(path).then((text) => (text ? text.trim().split('\n').filter(Boolean).length : 0));
        const seq = existing + 1;
        const full = { ...event, seq };
        await appendLine(path, JSON.stringify(full));
        return full;
    }
    async readAudit(bookId) {
        const text = await readOptional(join(this.bookDir(bookId), 'audit.jsonl'));
        if (text === undefined)
            return [];
        return text.trim().split('\n').filter(Boolean).map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return null;
            }
        }).filter((event) => event !== null);
    }
    async writeArtifact(bookId, phase, content) {
        const dir = this.bookDir(bookId);
        await mkdir(join(dir, 'docs'), { recursive: true, mode: 0o700 });
        await mkdir(join(dir, 'versions', phase), { recursive: true, mode: 0o700 });
        const versionsDir = join(dir, 'versions', phase);
        const existing = await readdir(versionsDir).catch(() => []);
        let maxVersion = 0;
        for (const name of existing) {
            const match = /^v(\d+)\.md$/.exec(name);
            if (match)
                maxVersion = Math.max(maxVersion, Number(match[1]));
        }
        const version = maxVersion + 1;
        const file = join(dir, 'docs', `${phase}.md`);
        await atomicWriteFile(file, content);
        await atomicWriteFile(join(versionsDir, `v${version}.md`), content);
        return { file, version };
    }
    async readArtifact(bookId, phase) {
        return await readOptional(join(this.bookDir(bookId), 'docs', `${phase}.md`));
    }
    async writeChapter(bookId, chapter, content) {
        if (!Number.isInteger(chapter.no) || chapter.no < 1) {
            throw { code: 'INVALID_FIELD_TYPE', message: `非法章节号: ${chapter.no}` };
        }
        const path = join(this.bookDir(bookId), 'chapters', `ch${chapter.no}.md`);
        await mkdir(join(this.bookDir(bookId), 'chapters'), { recursive: true, mode: 0o700 });
        await atomicWriteFile(path, `${encodeChapterFrontmatter(chapter)}${content.trimEnd()}\n`);
        return chapter;
    }
    async readChapter(bookId, no) {
        const text = await readOptional(join(this.bookDir(bookId), 'chapters', `ch${no}.md`));
        if (text === undefined)
            return undefined;
        const parsed = parseChapterFrontmatter(text);
        if (parsed)
            return { chapter: parsed.chapter, content: parsed.body.trimEnd() };
        return {
            chapter: { no, title: `第 ${no} 章`, status: 'draft', version: 1, words: 0, createdAt: '', updatedAt: '' },
            content: text.trimEnd(),
        };
    }
    async readChapterContent(bookId, no) {
        const chapter = await this.readChapter(bookId, no);
        return chapter?.content ?? '';
    }
    async listChapterNumbers(bookId) {
        const dir = join(this.bookDir(bookId), 'chapters');
        const names = await readdir(dir).catch(() => []);
        const numbers = [];
        for (const name of names) {
            const match = /^ch(\d+)\.md$/.exec(name);
            if (match)
                numbers.push(Number(match[1]));
        }
        return numbers.sort((a, b) => a - b);
    }
}
