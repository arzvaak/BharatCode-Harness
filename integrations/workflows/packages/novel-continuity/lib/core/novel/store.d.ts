import type { AuditEvent, PhaseId } from '../workflow/types.ts';
import type { Book, BookSummary, Chapter } from './types.ts';
export declare const BOOK_SCHEMA_VERSION = 1;
export declare function assertBookId(id: string): string;
export declare function encodeChapterFrontmatter(chapter: Chapter): string;
export declare function parseChapterFrontmatter(text: string): {
    chapter: Chapter;
    body: string;
} | null;
export declare class NovelStore {
    readonly baseDir: string;
    constructor(baseDir: string);
    private bookDir;
    getBookDir(id: string): string;
    private bookFile;
    createBook(params: {
        title: string;
        genre: string;
    }): Promise<Book>;
    loadBook(id: string): Promise<Book>;
    saveBook(book: Book): Promise<void>;
    listBooks(): Promise<BookSummary[]>;
    deleteProject(id: string, keepChapters: boolean): Promise<{
        deleted: boolean;
        keptChapters: boolean;
    }>;
    appendAudit(bookId: string, event: Omit<AuditEvent, 'seq'>): Promise<AuditEvent>;
    readAudit(bookId: string): Promise<AuditEvent[]>;
    writeArtifact(bookId: string, phase: PhaseId, content: string): Promise<{
        file: string;
        version: number;
    }>;
    readArtifact(bookId: string, phase: PhaseId): Promise<string | undefined>;
    writeChapter(bookId: string, chapter: Chapter, content: string): Promise<Chapter>;
    readChapter(bookId: string, no: number): Promise<{
        chapter: Chapter;
        content: string;
    } | undefined>;
    readChapterContent(bookId: string, no: number): Promise<string>;
    listChapterNumbers(bookId: string): Promise<number[]>;
}
