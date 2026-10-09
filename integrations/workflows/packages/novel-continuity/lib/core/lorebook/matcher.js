export class LoreMatcher {
    index = new Map();
    regexEntries = new Map();
    regexCache = new Map();
    byId = new Map();
    rebuild(entries) {
        this.index.clear();
        this.regexEntries.clear();
        this.regexCache.clear();
        this.byId.clear();
        for (const entry of entries) {
            this.byId.set(entry.id, entry);
            if (!entry.enabled || entry.keywords.length === 0)
                continue;
            if (entry.is_regex) {
                this.regexEntries.set(entry.id, entry);
                this.compileRegex(entry);
            }
            else {
                for (const keyword of entry.keywords) {
                    const key = keyword.toLowerCase();
                    const bucket = this.index.get(key);
                    if (bucket)
                        bucket.add(entry.id);
                    else
                        this.index.set(key, new Set([entry.id]));
                }
            }
        }
    }
    upsert(entry) {
        this.remove(entry.id);
        this.byId.set(entry.id, entry);
        if (!entry.enabled || entry.keywords.length === 0)
            return;
        if (entry.is_regex) {
            this.regexEntries.set(entry.id, entry);
            this.compileRegex(entry);
        }
        else {
            for (const keyword of entry.keywords) {
                const key = keyword.toLowerCase();
                const bucket = this.index.get(key);
                if (bucket)
                    bucket.add(entry.id);
                else
                    this.index.set(key, new Set([entry.id]));
            }
        }
    }
    remove(entryId) {
        this.byId.delete(entryId);
        this.regexEntries.delete(entryId);
        this.regexCache.delete(entryId);
        for (const bucket of this.index.values()) {
            bucket.delete(entryId);
        }
    }
    match(text, options = {}) {
        if (!text)
            return [];
        const hits = [];
        const seen = new Set();
        const lowerText = text.toLowerCase();
        for (const [token, entryIds] of this.index) {
            if (!lowerText.includes(token))
                continue;
            for (const entryId of entryIds) {
                if (seen.has(entryId))
                    continue;
                if (options.entryIds && !options.entryIds.has(entryId))
                    continue;
                const entry = this.byId.get(entryId);
                if (!entry)
                    continue;
                const sensitive = entry.case_sensitive || options.caseSensitive;
                const hitKeyword = entry.keywords.find((kw) => sensitive ? text.includes(kw) : lowerText.includes(kw.toLowerCase()));
                if (sensitive && hitKeyword === undefined)
                    continue;
                seen.add(entryId);
                hits.push({ entry, hitKeyword, via: 'keyword' });
            }
        }
        for (const [entryId, entry] of this.regexEntries) {
            if (seen.has(entryId))
                continue;
            if (options.entryIds && !options.entryIds.has(entryId))
                continue;
            const regexes = this.regexCache.get(entryId);
            if (!regexes)
                continue;
            let matched = false;
            for (const regex of regexes) {
                regex.lastIndex = 0;
                if (regex.test(text)) {
                    matched = true;
                    break;
                }
            }
            if (matched) {
                seen.add(entryId);
                hits.push({ entry, via: 'regex' });
            }
        }
        return hits;
    }
    stats() {
        return { keywordTokens: this.index.size, regexEntries: this.regexEntries.size, totalEntries: this.byId.size };
    }
    compileRegex(entry) {
        const compiled = [];
        for (const keyword of entry.keywords) {
            try {
                const flags = entry.case_sensitive ? 'g' : 'gi';
                compiled.push(new RegExp(keyword, flags));
            }
            catch {
                this.regexCache.set(entry.id, null);
                return;
            }
        }
        this.regexCache.set(entry.id, compiled.length > 0 ? compiled : null);
    }
}
