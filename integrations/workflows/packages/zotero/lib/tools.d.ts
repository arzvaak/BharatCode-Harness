/**
 * Model-facing Zotero tools for DeepSeek Harness.
 *
 * Read path  — Zotero 7+ local API (`/api/users/{id}/…`, read-only mirror of the web API).
 * Write path — connector `saveItems` (the browser extension's save endpoint), the only
 *              sanctioned localhost write. Metadata updates/deletes are impossible over
 *              localhost by design; see README.
 *
 * Safety rules (carried over from the zotero-skills operating doctrine):
 * - one `zotero_add_item` call saves exactly ONE item (no batch write tool);
 * - note content is returned as plain text so library markup never reaches the model raw;
 * - destructive operations simply have no tool.
 */
import type { Config } from './config.ts';
import type { ZoteroLocalClient } from './client.ts';
import { attachmentInfo, compactItem, extractYear, formatCreators, noteInfo, stripHtml, truncate } from './format.ts';
export declare function buildTools(client: ZoteroLocalClient, config: Config): import("@deepseek-ai/dsh-tools").ToolDefinition[];
export { attachmentInfo, compactItem, extractYear, formatCreators, noteInfo, stripHtml, truncate };
