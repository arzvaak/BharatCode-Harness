import { type VariableStoreData } from './types.ts';
export declare const VARIABLES_SCHEMA_VERSION = 1;
export declare class VariableStoreFile {
    private readonly filePath;
    constructor(filePath: string);
    load(): Promise<VariableStoreData>;
    save(data: VariableStoreData): Promise<void>;
    applyChapterPatch(bookId: string, chapterNo: number, chapterText: string): Promise<boolean>;
    ensureBookVariables(bookId: string, initTemplate: Record<string, unknown> | null): Promise<boolean>;
}
export declare function variablesFilePath(bookDir: string): string;
