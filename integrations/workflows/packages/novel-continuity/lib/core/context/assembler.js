import { join } from 'node:path';
import { estimateTokens } from "../util.js";
import { buildInjectionPlan } from "../lorebook/injector.js";
export const DEFAULT_CONTEXT_BUDGET = 12000;
export const DEFAULT_PREV_CHAPTERS = 3;
const L1_BUDGET = 500;
const SUMMARY_BUDGET = 200;
export class ContextAssembler {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async assemble(options) {
        const { book, chapterNo } = options;
        const budget = options.contextBudget ?? DEFAULT_CONTEXT_BUDGET;
        const prevCount = options.prevChaptersFull ?? DEFAULT_PREV_CHAPTERS;
        const bookDir = this.deps.store.getBookDir(book.id);
        const truncatedInfo = [];
        const briefArtifact = await this.deps.store.readArtifact(book.id, 'chapter');
        const currentBrief = (options.chapterBrief ?? '').trim() || briefArtifact || '';
        const volumeOutline = (await this.deps.store.readArtifact(book.id, 'volume')) ?? '';
        const outlineArtifact = (await this.deps.store.readArtifact(book.id, 'outline')) ?? '';
        const prevChapters = [];
        for (let no = chapterNo - 1; no >= Math.max(1, chapterNo - prevCount); no -= 1) {
            const chapter = await this.deps.store.readChapter(book.id, no);
            if (chapter)
                prevChapters.unshift({ no, title: chapter.chapter.title, text: chapter.content });
        }
        const prevSummaries = [];
        const earliestFull = Math.max(1, chapterNo - prevCount);
        for (let no = earliestFull - 1; no >= 1; no -= 1) {
            const summaryFile = join(bookDir, 'summary', `summary-${no}.md`);
            const { readOptional } = await import("../atomic-file.js");
            let text = (await readOptional(summaryFile)) ?? '';
            if (!text.trim()) {
                const chapter = await this.deps.store.readChapter(book.id, no);
                text = chapter ? chapter.content.slice(0, SUMMARY_BUDGET) : '';
            }
            if (text.trim())
                prevSummaries.unshift({ no, text: text.trim().slice(0, SUMMARY_BUDGET) });
            if (prevSummaries.length >= 50)
                break;
        }
        const variableData = await this.deps.variables.load();
        const variableSnapshot = variableData.books[book.id]?.local_variables?.stat_data;
        const entries = await this.deps.loreStore.readEntries();
        const groups = await this.deps.loreStore.readGroups();
        const settings = await this.deps.loreStore.readSettings();
        const scanHistory = options.scanHistory ?? prevChapters.map((c) => c.text);
        const loreInjection = buildInjectionPlan(entries, groups, {
            scope: 'lorebook',
            bookId: book.id,
            scanText: currentBrief,
            historyTexts: scanHistory,
            budget: options.injectionBudget ?? Math.floor(budget / 3),
            charName: options.charName,
            userName: options.userName,
            variableContext: {
                localVariables: variableData.books[book.id]?.local_variables ?? {},
                bookVariables: variableData.book_variables[book.id] ?? {},
                globalVariables: variableData.global_variables,
            },
        });
        const style = book.config.style;
        let projectBrief = `《${book.title}》（${book.genre}）\nStyle: ${style.pov === 'first' ? 'first person' : 'third person'}${style.forbiddenWords.length ? `; Forbidden words: ${style.forbiddenWords.join('、')}` : ''}\nOutline: ${outlineArtifact || '(not supplied)'}`;
        if (estimateTokens(projectBrief) > L1_BUDGET) {
            projectBrief = projectBrief.slice(0, L1_BUDGET * 2);
            truncatedInfo.push('L1 project outline exceeded the budget and was truncated');
        }
        let tokenEstimate = estimateTokens(projectBrief + currentBrief + volumeOutline + prevChapters.map((c) => c.text).join('') + JSON.stringify(prevSummaries));
        const maxL3 = budget - Math.floor(budget / 3);
        if (tokenEstimate > maxL3 && prevSummaries.length > 0) {
            const before = prevSummaries.length;
            prevSummaries.length = Math.max(0, Math.floor(prevSummaries.length / 2));
            truncatedInfo.push(`L3 summaries exceeded the budget; reduced from ${before} to ${prevSummaries.length}`);
            tokenEstimate = estimateTokens(projectBrief + currentBrief + volumeOutline + prevChapters.map((c) => c.text).join('') + JSON.stringify(prevSummaries));
        }
        if (tokenEstimate > budget && prevChapters.length > 1) {
            const before = prevChapters.length;
            prevChapters.length = Math.max(1, Math.floor(prevChapters.length / 2));
            truncatedInfo.push(`L2 prior chapters exceeded the budget; reduced from ${before} to ${prevChapters.length}`);
            tokenEstimate = estimateTokens(projectBrief + currentBrief + volumeOutline + prevChapters.map((c) => c.text).join('') + JSON.stringify(prevSummaries));
        }
        const constraints = [
            `Chapter target length: ${book.config.wordTargets.perChapterMin}-${book.config.wordTargets.perChapterMax}(total characters)`,
            `Point of view: ${style.pov === 'first' ? 'first person' : 'third person'}`,
            ...(style.forbiddenWords.length > 0 ? [`Forbidden words: ${style.forbiddenWords.join('、')}`] : []),
            'End the chapter with a hook: suspense, conflict, or a turning point',
            'Do not reveal unresolved foreshadowing prematurely',
            'Use lorebook entries as the reference for established world details; preserve consistency',
        ];
        return {
            bookId: book.id,
            chapterNo,
            projectBrief,
            style,
            currentBrief,
            volumeOutline: volumeOutline || outlineArtifact,
            prevChapters,
            prevSummaries,
            ...(variableSnapshot !== undefined ? { variableSnapshot } : {}),
            loreInjection,
            constraints,
            tokenEstimate,
            truncatedInfo,
        };
    }
}
