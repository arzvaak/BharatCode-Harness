import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
export declare function renderJson(_args: unknown, value: JsonValue): ContentBlock[];
export declare function jsonOutput(): {
    schema: {
        type: "json";
    };
    render: typeof renderJson;
};
