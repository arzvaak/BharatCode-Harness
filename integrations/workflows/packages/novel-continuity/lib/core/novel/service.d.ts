import type { AuditEvent, PhaseId } from '../workflow/types.ts';
import type { PhaseReport } from '../workflow/types.ts';
import type { Book, BookSummary, Chapter } from './types.ts';
import type { NovelStore } from './store.ts';
import type { VariableStoreFile } from '../variables/store.ts';
import type { ContextPacket } from '../context/types.ts';
import { ContextAssembler } from '../context/assembler.ts';
import type { LoreStore } from '../lorebook/store.ts';
export interface NovelServiceDeps {
    store: NovelStore;
    loreStore: LoreStore;
    variables: VariableStoreFile;
    assembler?: ContextAssembler;
}
export declare class NovelService {
    private readonly store;
    private readonly variables;
    private readonly assembler;
    constructor(deps: NovelServiceDeps);
    createProject(title: string, genre: string): Promise<Book>;
    artifactOf(bookId: string, phase: PhaseId): Promise<string | undefined>;
    cloneProject(sourceId: string, options?: {
        title?: string;
        genre?: string;
    }): Promise<Book>;
    listProjects(): Promise<BookSummary[]>;
    projectDir(bookId: string): string;
    load(bookId: string): Promise<Book>;
    private mergeLedger;
    enterPhase(bookId: string, phaseId: PhaseId, actor?: AuditEvent['actor']): Promise<Book>;
    commitPhase(bookId: string, phaseId: PhaseId, artifact: string, report: PhaseReport, actor?: AuditEvent['actor']): Promise<Book>;
    overridePhase(bookId: string, phaseId: PhaseId, action: 'force' | 'reopen' | 'skip' | 'rollback', actor?: AuditEvent['actor']): Promise<Book>;
    audit(bookId: string): Promise<AuditEvent[]>;
    assemble(bookId: string, chapterNo: number, chapterBrief?: string): Promise<ContextPacket>;
    saveChapter(bookId: string, chapterNo: number, title: string, text: string, brief?: string): Promise<Chapter>;
    chapterStats(bookId: string, chapterNo: number): Promise<{
        words: number;
        meetsTarget: boolean;
    } | undefined>;
    chapterText(bookId: string, chapterNo: number): Promise<string>;
    chapterWithText(bookId: string, chapterNo: number): Promise<{
        chapter: Chapter;
        content: string;
    } | undefined>;
    allChapters(bookId: string): Promise<Array<{
        chapter: Chapter;
        content: string;
    }>>;
    deleteProject(bookId: string, keepChapters: boolean): Promise<{
        deleted: boolean;
        keptChapters: boolean;
    }>;
    exportProject(bookId: string, format: 'txt' | 'markdown' | 'platform'): Promise<{
        fileName: string;
        content: string;
    }>;
}
