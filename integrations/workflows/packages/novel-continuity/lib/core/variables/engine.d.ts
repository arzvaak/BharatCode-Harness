import type { PatchOperation, VariableContext } from './types.ts';
export declare const DEFAULT_VARIABLE_NAME = "stat_data";
export declare function parseIndentedYamlLike(text: string): unknown;
export declare function parseInitVarTemplate(entries: ReadonlyArray<{
    name: string;
    content: string;
}>): Record<string, unknown> | null;
export declare function getValueByPointer(root: unknown, path: string): unknown;
export declare function applyPatchOperations(variableMap: Record<string, unknown>, operations: readonly PatchOperation[]): boolean;
export declare function extractJsonPatchOperations(text: string): PatchOperation[];
export declare function renderVariables(content: string, context: VariableContext): string;
export declare function renderNameMacros(content: string, charName: string, userName: string): string;
