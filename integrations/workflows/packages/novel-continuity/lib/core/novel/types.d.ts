import type { PhaseId, PhaseRecord } from '../workflow/types.ts';
export type BookStatus = 'drafting' | 'finished' | 'abandoned';
export interface BookConfig {
    title: string;
    author?: string;
    genre: string;
    wordTargets: {
        perChapterMin: number;
        perChapterMax: number;
    };
    style: {
        pov: 'first' | 'third';
        forbiddenWords: string[];
        aiTasteWords: string[];
    };
    phaseGating: boolean;
}
export interface Chapter {
    no: number;
    title: string;
    status: 'draft' | 'revised' | 'approved';
    version: number;
    words: number;
    brief?: string;
    createdAt: string;
    updatedAt: string;
}
export interface Book {
    id: string;
    title: string;
    genre: string;
    status: BookStatus;
    config: BookConfig;
    phases: Record<PhaseId, PhaseRecord>;
    currentPhase: PhaseId;
    stats: {
        totalWords: number;
        chapterCount: number;
        lastWriteAt?: string;
    };
    createdAt: string;
    updatedAt: string;
    schemaVersion: number;
}
export interface BookSummary {
    id: string;
    title: string;
    genre: string;
    status: BookStatus;
    currentPhase: PhaseId;
    chapterCount: number;
    totalWords: number;
    updatedAt: string;
}
