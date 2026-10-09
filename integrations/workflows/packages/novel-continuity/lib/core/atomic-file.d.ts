export interface AtomicWriteOptions {
    backup?: boolean;
    keepBackups?: number;
}
export declare function atomicWriteFile(path: string, content: string, options?: AtomicWriteOptions): Promise<void>;
export declare function appendLine(path: string, line: string): Promise<void>;
export declare function readOptional(path: string): Promise<string | undefined>;
