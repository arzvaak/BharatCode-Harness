import type { Chapter } from '../novel/types.ts';
export type ExportFormat = 'txt' | 'markdown' | 'platform';
export interface ExportOptions {
    format: ExportFormat;
    title: string;
    author?: string;
    splitVolumes?: boolean;
    authorNotes?: string;
}
export interface ExportedChapter {
    chapter: Chapter;
    content: string;
}
export declare function formatChapter(chapter: Chapter, content: string, format: ExportFormat): string;
export declare function exportBook(chapters: Array<{
    chapter: Chapter;
    content: string;
}>, options: ExportOptions): string;
export declare function platformChapter(chapter: Chapter, content: string): string;
