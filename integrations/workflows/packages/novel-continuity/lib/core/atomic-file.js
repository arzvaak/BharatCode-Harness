import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nowIso } from "./util.js";
export async function atomicWriteFile(path, content, options = {}) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (options.backup) {
        const existing = await stat(path).catch(() => undefined);
        if (existing?.isFile()) {
            const backupPath = join(dirname(path), `${baseStem(path)}.bak.${nowIso().replace(/[:.]/g, '-')}`);
            await copyFile(path, backupPath);
            const keep = options.keepBackups ?? 5;
            if (keep > 0)
                await pruneBackups(dirname(path), baseStem(path), keep);
        }
    }
    const temporary = `${path}.tmp.${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, path);
    }
    catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}
export async function appendLine(path, line) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(path, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
}
export async function readOptional(path) {
    return await readFile(path, 'utf8').catch((error) => {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    });
}
function baseStem(path) {
    const base = path.split(/[\\/]/).at(-1) ?? path;
    return base.replace(/\.json$|\.md$|\.jsonl$/, '');
}
async function copyFile(source, destination) {
    const content = await readFile(source);
    await writeFile(destination, content, { mode: 0o600 });
}
async function pruneBackups(dir, stem, keep) {
    const entries = await readdirSafe(dir);
    const backups = entries.filter((name) => name.startsWith(`${stem}.bak.`)).sort();
    for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
        await rm(join(dir, name), { force: true }).catch(() => undefined);
    }
}
async function readdirSafe(dir) {
    const { readdir } = await import('node:fs/promises');
    return await readdir(dir).catch(() => []);
}
