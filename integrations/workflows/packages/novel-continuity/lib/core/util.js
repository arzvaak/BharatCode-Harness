import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export function newId(prefix) {
    const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
export function nowIso() {
    return new Date().toISOString();
}
export function normalizeKeywords(raw) {
    if (raw == null)
        return [];
    if (Array.isArray(raw)) {
        return raw.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0);
    }
    return String(raw)
        .split(/[,，]/)
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0);
}
export function normalizeNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
export function clampInt(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.min(max, Math.max(min, Math.trunc(value)));
}
export function estimateTokens(text) {
    let cjk = 0;
    let other = 0;
    for (const char of text) {
        if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char))
            cjk += 1;
        else
            other += 1;
    }
    return cjk + Math.ceil(other / 4);
}
export function resolveAssetsDir(fromModuleUrl) {
    const here = fileURLToPath(new URL('.', fromModuleUrl));
    const cached = assetsDirCache.get(here);
    if (cached !== undefined)
        return cached;
    for (const candidate of ['../../assets', '../assets', './assets']) {
        const dir = resolve(here, candidate);
        if (existsSync(dir)) {
            assetsDirCache.set(here, dir);
            return dir;
        }
    }
    const fallback = resolve(here, '../../assets');
    assetsDirCache.set(here, fallback);
    return fallback;
}
const assetsDirCache = new Map();
