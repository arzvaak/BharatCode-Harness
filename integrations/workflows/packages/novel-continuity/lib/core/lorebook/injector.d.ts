import type { InjectionPlan, LoreEntry, LoreGroup } from '../types.ts';
import type { VariableContext } from '../variables/types.ts';
export interface InjectOptions {
    scope: InjectionPlan['scope'];
    bookId?: string;
    scanText: string;
    historyTexts?: string[];
    budget: number;
    charName?: string;
    userName?: string;
    variableContext?: VariableContext;
}
export interface PlanExcluded {
    entry: LoreEntry;
    reason: 'budget' | 'disabled-group' | 'book-mismatch' | 'no-keyword-hit';
}
export declare function buildInjectionPlan(entries: readonly LoreEntry[], groups: readonly LoreGroup[], options: InjectOptions): InjectionPlan;
