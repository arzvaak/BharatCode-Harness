import { mkdir, readFile, writeFile, rename, readdir, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { starter } from './templates.js';

export const MAX_SOURCE_BYTES = 1024 * 1024;
export function engineName(engine) {
  if (!['three', 'babylon'].includes(engine)) throw Error('Unsupported engine');
  return engine;
}
export function projectId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid project ID');
  return id;
}
export async function safeDirectory(directory) {
  const path = resolve(directory);
  if (dirname(path) !== path) await safeDirectory(dirname(path));
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw Error('Symlink project directories are forbidden');
    if (!info.isDirectory()) throw Error('Project directory is not a directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(path, {mode: 0o700});
  }
  return path;
}
export async function safeRead(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SOURCE_BYTES + 16384) throw Error('Invalid project file');
  return readFile(path, 'utf8');
}
export class ProjectStore {
  constructor(directory) { this.directory = resolve(directory); this.locks = new Map(); }
  owner(scope) {
    if (typeof scope !== 'string' || !scope || scope.length > 4096) throw Error('Workspace required');
    return createHash('sha256').update(scope).digest('hex');
  }
  path(scope, id) { return join(this.directory, this.owner(scope), projectId(id)); }
  async locked(key, action) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(done => { release = done; });
    this.locks.set(key, current);
    await previous;
    try { return await action(); } finally { release(); if (this.locks.get(key) === current) this.locks.delete(key); }
  }
  async create(scope, engine, title, source) {
    engineName(engine);
    if (typeof title !== 'string' || !title.trim() || title.length > 160) throw Error('Title must contain 1–160 characters');
    source ??= starter(engine);
    this.validateSource(source);
    const id = randomUUID(), directory = this.path(scope, id);
    await safeDirectory(directory);
    const project = {id, engine, title: title.trim(), revision: 1, source, createdAt: new Date().toISOString()};
    await writeFile(join(directory, 'revision-1.json'), JSON.stringify(project), {flag: 'wx', mode: 0o600});
    await writeFile(join(directory, 'current.json'), JSON.stringify({revision: 1}), {flag: 'wx', mode: 0o600});
    return project;
  }
  validateSource(source) {
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw Error('Source must contain 1–1048576 bytes');
  }
  async get(scope, id, engine) {
    engineName(engine);
    const directory = this.path(scope, id);
    try {
      await this.existingDirectory(directory);
      const current = JSON.parse(await safeRead(join(directory, 'current.json')));
      if (!Number.isSafeInteger(current.revision) || current.revision < 1) throw Error('Invalid revision pointer');
      const project = JSON.parse(await safeRead(join(directory, `revision-${current.revision}.json`)));
      if (project.id !== id || project.engine !== engine) throw Error('Project engine mismatch');
      this.validateSource(project.source);
      return project;
    } catch (error) { if (error.code === 'ENOENT') throw Error('Project not found in this workspace'); throw error; }
  }
  async existingDirectory(directory) {
    // Check ancestors without creating missing project paths during reads.
    let current = resolve(directory);
    while (dirname(current) !== current) {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw Error('Symlink project directories are forbidden');
      if (!info.isDirectory()) throw Error('Invalid project directory');
      current = dirname(current);
    }
  }
  async update(scope, id, engine, {source, expectedRevision}) {
    this.validateSource(source);
    return this.locked(this.path(scope, id), async () => {
      const previous = await this.get(scope, id, engine);
      if (expectedRevision !== previous.revision) throw Error(`Revision conflict: current revision is ${previous.revision}`);
      const project = {...previous, source, revision: previous.revision + 1, updatedAt: new Date().toISOString()};
      const directory = this.path(scope, id);
      await writeFile(join(directory, `revision-${project.revision}.json`), JSON.stringify(project), {flag: 'wx', mode: 0o600});
      const pointer = join(directory, `current-${randomUUID()}.tmp`);
      await writeFile(pointer, JSON.stringify({revision: project.revision}), {flag: 'wx', mode: 0o600});
      await rename(pointer, join(directory, 'current.json'));
      return project;
    });
  }
  async list(scope) {
    const directory = join(this.directory, this.owner(scope));
    try { await this.existingDirectory(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const items = [];
    for (const item of await readdir(directory, {withFileTypes: true})) {
      if (!item.isDirectory() || !/^[a-f0-9-]{36}$/.test(item.name)) continue;
      for (const engine of ['three', 'babylon']) {
        try { const {source, ...metadata} = await this.get(scope, item.name, engine); items.push(metadata); break; }
        catch (error) { if (!/engine mismatch/.test(error.message)) throw error; }
      }
    }
    return items;
  }
}
