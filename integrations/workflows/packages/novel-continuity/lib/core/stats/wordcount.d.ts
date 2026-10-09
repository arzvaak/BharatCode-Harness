import type { ChapterStats } from '../types.ts';
export declare function countChapter(text: string, chapterNo: number): ChapterStats;
export declare function checkWordTarget(stats: ChapterStats, min: number, max: number, useCjk?: boolean): ChapterStats;
