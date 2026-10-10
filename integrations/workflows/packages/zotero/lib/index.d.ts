/**
 * dsh-zotero — Zotero library tools for DeepSeek Harness, talking to the local
 * Zotero desktop server on 127.0.0.1:23119 only (no cloud calls, no API key).
 *
 * Dev loading (from the harness repo root):
 *   pnpm run start:web --patch ./zotero-plugin/cordis.yml
 *
 * Everything registered here lives in one effect scope, so unloading the
 * plugin (config edit / HMR / shutdown) unregisters all ten tools automatically.
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type Config as ConfigShape } from './config.ts';
export declare const name = "zotero";
export declare const inject: string[];
export { Config };
export declare function apply(ctx: Context, config: ConfigShape): void;
