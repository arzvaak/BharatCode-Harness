import type { InjectionPlan } from '../types.ts';
import type { BookConfig } from '../novel/types.ts';
export interface PrevChapterRef {
    no: number;
    title: string;
    text: string;
}
export interface ContextPacket {
    bookId: string;
    chapterNo: number;
    projectBrief: string;
    style: BookConfig['style'];
    currentBrief: string;
    volumeOutline: string;
    prevChapters: PrevChapterRef[];
    prevSummaries: Array<{
        no: number;
        text: string;
    }>;
    variableSnapshot?: Record<string, unknown>;
    loreInjection: InjectionPlan;
    constraints: string[];
    tokenEstimate: number;
    truncatedInfo: string[];
}
