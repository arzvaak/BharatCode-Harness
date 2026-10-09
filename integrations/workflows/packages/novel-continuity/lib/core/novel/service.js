import { PHASE_ORDER, enter, forceApprove, reopen, rollback, skip, submit } from "../workflow/engine.js";
import { checkWordTarget, countChapter } from "../stats/wordcount.js";
import { ContextAssembler } from "../context/assembler.js";
export class NovelService {
    store;
    variables;
    assembler;
    constructor(deps) {
        this.store = deps.store;
        this.variables = deps.variables;
        this.assembler = deps.assembler ?? new ContextAssembler({ store: deps.store, loreStore: deps.loreStore, variables: deps.variables });
    }
    async createProject(title, genre) {
        return await this.store.createBook({ title, genre });
    }
    async artifactOf(bookId, phase) {
        return await this.store.readArtifact(bookId, phase);
    }
    async cloneProject(sourceId, options = {}) {
        const source = await this.store.loadBook(sourceId);
        const title = String(options.title ?? '').trim() || `${source.title} (template)`;
        const genre = String(options.genre ?? '').trim() || source.genre;
        const book = await this.store.createBook({ title, genre });
        const config = { ...source.config, title, genre, phaseGating: true };
        await this.store.saveBook({ ...book, config });
        for (const phase of PHASE_ORDER) {
            if (phase === 'writing' || phase === 'revision' || phase === 'done')
                continue;
            const artifact = await this.store.readArtifact(sourceId, phase);
            if (artifact)
                await this.store.writeArtifact(book.id, phase, artifact);
        }
        return await this.store.loadBook(book.id);
    }
    listProjects() {
        return this.store.listBooks();
    }
    projectDir(bookId) {
        return this.store.getBookDir(bookId);
    }
    async load(bookId) {
        return await this.store.loadBook(bookId);
    }
    mergeLedger(book, ledger, now) {
        return {
            ...book,
            phases: ledger.phases,
            currentPhase: ledger.currentPhase,
            updatedAt: now,
        };
    }
    async enterPhase(bookId, phaseId, actor = 'agent') {
        const book = await this.store.loadBook(bookId);
        const now = new Date().toISOString();
        const result = enter(book, phaseId, now, actor);
        if (!result.ok)
            throw result.error;
        await this.store.appendAudit(bookId, result.value.event);
        await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now));
        return await this.store.loadBook(bookId);
    }
    async commitPhase(bookId, phaseId, artifact, report, actor = 'agent') {
        const book = await this.store.loadBook(bookId);
        const now = new Date().toISOString();
        const result = submit(book, phaseId, report, now, actor);
        if (!result.ok)
            throw result.error;
        await this.store.writeArtifact(bookId, phaseId, artifact);
        await this.store.appendAudit(bookId, result.value.event);
        await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now));
        return await this.store.loadBook(bookId);
    }
    async overridePhase(bookId, phaseId, action, actor = 'user') {
        const book = await this.store.loadBook(bookId);
        const now = new Date().toISOString();
        const result = action === 'force'
            ? forceApprove(book, phaseId, now, actor)
            : action === 'reopen'
                ? reopen(book, phaseId, now, actor)
                : action === 'skip'
                    ? skip(book, phaseId, now, actor)
                    : rollback(book, phaseId, now, actor);
        if (!result.ok)
            throw result.error;
        await this.store.appendAudit(bookId, result.value.event);
        await this.store.saveBook(this.mergeLedger(book, result.value.ledger, now));
        return await this.store.loadBook(bookId);
    }
    audit(bookId) {
        return this.store.readAudit(bookId);
    }
    async assemble(bookId, chapterNo, chapterBrief) {
        const book = await this.store.loadBook(bookId);
        return await this.assembler.assemble({ book, chapterNo, chapterBrief });
    }
    async saveChapter(bookId, chapterNo, title, text, brief) {
        const book = await this.store.loadBook(bookId);
        const now = new Date().toISOString();
        const raw = countChapter(text, chapterNo);
        const stats = checkWordTarget(raw, book.config.wordTargets.perChapterMin, book.config.wordTargets.perChapterMax);
        const previous = await this.store.readChapter(bookId, chapterNo);
        const previousWords = previous?.chapter.words ?? 0;
        const chapter = {
            no: chapterNo,
            title,
            status: 'draft',
            version: (previous?.chapter.version ?? 0) + 1,
            words: stats.totalChars,
            ...(brief !== undefined ? { brief } : {}),
            createdAt: previous?.chapter.createdAt ?? now,
            updatedAt: now,
        };
        await this.store.writeChapter(bookId, chapter, text);
        const nextBook = {
            ...book,
            stats: {
                totalWords: Math.max(0, book.stats.totalWords - previousWords + stats.totalChars),
                chapterCount: Math.max(book.stats.chapterCount, previous ? book.stats.chapterCount : book.stats.chapterCount + 1),
                lastWriteAt: now,
            },
            updatedAt: now,
        };
        await this.store.saveBook(nextBook);
        await this.variables.applyChapterPatch(bookId, chapterNo, text);
        const { LedgerStore, ledgerFilePath } = await import("../consistency/store.js");
        await new LedgerStore(ledgerFilePath(this.store.getBookDir(bookId))).applyChapterPatch(bookId, chapterNo, text);
        await this.store.appendAudit(bookId, {
            at: now,
            action: 'submit',
            phase: 'writing',
            actor: 'agent',
            detail: `chapter ${chapterNo} saved (${stats.totalChars} chars, ${stats.meetsTarget ? 'meets' : 'below'} target)`,
        });
        return chapter;
    }
    async chapterStats(bookId, chapterNo) {
        const book = await this.store.loadBook(bookId);
        const chapter = await this.store.readChapter(bookId, chapterNo);
        if (!chapter)
            return undefined;
        const stats = checkWordTarget(countChapter(chapter.content, chapterNo), book.config.wordTargets.perChapterMin, book.config.wordTargets.perChapterMax);
        return { words: stats.totalChars, meetsTarget: stats.meetsTarget };
    }
    async chapterText(bookId, chapterNo) {
        return await this.store.readChapterContent(bookId, chapterNo);
    }
    async chapterWithText(bookId, chapterNo) {
        return await this.store.readChapter(bookId, chapterNo);
    }
    async allChapters(bookId) {
        const numbers = await this.store.listChapterNumbers(bookId);
        const items = [];
        for (const no of numbers) {
            const chapter = await this.store.readChapter(bookId, no);
            if (chapter)
                items.push(chapter);
        }
        return items;
    }
    async deleteProject(bookId, keepChapters) {
        return await this.store.deleteProject(bookId, keepChapters);
    }
    async exportProject(bookId, format) {
        const { exportBook } = await import("../export/engine.js");
        const book = await this.store.loadBook(bookId);
        const chapters = await this.allChapters(bookId);
        const content = exportBook(chapters, {
            format,
            title: book.title,
            author: book.config.author,
            splitVolumes: format === 'platform',
        });
        const ext = format === 'markdown' ? 'md' : 'txt';
        const fileName = `${book.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
        return { fileName, content };
    }
}
