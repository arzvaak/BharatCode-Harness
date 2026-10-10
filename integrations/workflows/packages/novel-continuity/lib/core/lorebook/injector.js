import { estimateTokens } from "../util.js";
import { renderNameMacros, renderVariables } from "../variables/engine.js";
function groupEntryMap(groups) {
    const map = new Map();
    for (const group of groups) {
        for (const entryId of group.entry_ids)
            map.set(entryId, group);
    }
    return map;
}
function matchesBook(entry, groupOf, bookId) {
    if (entry.book_id)
        return !!bookId && entry.book_id === bookId;
    const groupBookIds = groupOf?.book_ids ?? [];
    if (groupBookIds.length > 0)
        return !!bookId && groupBookIds.includes(bookId);
    return true;
}
function keywordHits(entry, text) {
    if (!text || entry.keywords.length === 0)
        return undefined;
    if (entry.is_regex) {
        for (const keyword of entry.keywords) {
            try {
                const regex = new RegExp(keyword, entry.case_sensitive ? 'g' : 'gi');
                if (regex.test(text))
                    return keyword;
            }
            catch {
            }
        }
        return undefined;
    }
    for (const keyword of entry.keywords) {
        if (entry.case_sensitive) {
            if (text.includes(keyword))
                return keyword;
        }
        else if (text.toLowerCase().includes(keyword.toLowerCase())) {
            return keyword;
        }
    }
    return undefined;
}
function buildInjection(entries) {
    if (entries.length === 0)
        return '';
    const parts = ['<worldbook>'];
    for (const entry of entries) {
        parts.push(`<entry name="${escapeAttr(entry.name)}">`);
        parts.push(entry.content);
        parts.push('</entry>');
    }
    parts.push('</worldbook>');
    return parts.join('\n');
}
function escapeAttr(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function buildInjectionPlan(entries, groups, options) {
    const groupOf = groupEntryMap(groups);
    const scanHistory = options.historyTexts ?? [];
    const budget = Math.max(0, options.budget);
    const enabledEntries = entries.filter((entry) => entry && entry.enabled !== false);
    const prepend = [];
    const append = [];
    const atDepth = [];
    const truncated = [];
    for (const entry of enabledEntries) {
        const group = groupOf.get(entry.id);
        if (group && group.enabled === false) {
            truncated.push({ entry, reason: 'disabled-group' });
            continue;
        }
        if (!matchesBook(entry, group, options.bookId)) {
            truncated.push({ entry, reason: 'book-mismatch' });
            continue;
        }
        if (!entry.always_active)
            continue;
        if (entry.inject_target === 'assistant' || entry.inject_position === 'at_depth') {
            atDepth.push({ entry, depth: Math.max(0, entry.insertion_depth || 0) });
        }
        else if (entry.inject_target === 'user') {
            append.push(entry);
        }
        else {
            ;
            (entry.inject_position === 'prepend' ? prepend : append).push(entry);
        }
    }
    const scanTexts = [options.scanText];
    const depth = scanHistory.length;
    for (const entry of enabledEntries) {
        if (entry.always_active || entry.keywords.length === 0)
            continue;
        const group = groupOf.get(entry.id);
        if (group && group.enabled === false) {
            truncated.push({ entry, reason: 'disabled-group' });
            continue;
        }
        if (!matchesBook(entry, group, options.bookId)) {
            truncated.push({ entry, reason: 'book-mismatch' });
            continue;
        }
        const scanDepth = Math.max(0, Math.min(entry.scan_depth || 0, depth));
        const texts = scanDepth > 0 ? [...scanTexts, ...scanHistory.slice(-scanDepth)] : scanTexts;
        const hit = texts.some((text) => keywordHits(entry, text) !== undefined);
        if (!hit)
            continue;
        if (entry.inject_target === 'assistant' || entry.inject_position === 'at_depth') {
            atDepth.push({ entry, depth: Math.max(0, entry.insertion_depth || 0) });
        }
        else if (entry.inject_target === 'user') {
            append.push(entry);
        }
        else {
            ;
            (entry.inject_position === 'prepend' ? prepend : append).push(entry);
        }
    }
    const sortByPriority = (a, b) => (b.priority || 50) - (a.priority || 50) || a.id.localeCompare(b.id);
    prepend.sort(sortByPriority);
    append.sort(sortByPriority);
    atDepth.sort((a, b) => b.depth - a.depth || sortByPriority(a.entry, b.entry));
    if (budget > 0) {
        let used = 0;
        const keep = (list) => {
            const kept = [];
            for (const entry of list) {
                const tokens = estimateTokens(entry.content);
                if (used + tokens > budget) {
                    truncated.push({ entry, reason: 'budget' });
                    continue;
                }
                used += tokens;
                kept.push(entry);
            }
            return kept;
        };
        const keptPrepend = keep(prepend);
        const keptAppend = keep(append);
        prepend.length = 0;
        append.length = 0;
        prepend.push(...keptPrepend);
        append.push(...keptAppend);
        const keptDepth = [];
        for (const item of atDepth) {
            const tokens = estimateTokens(item.entry.content);
            if (used + tokens > budget) {
                truncated.push({ entry: item.entry, reason: 'budget' });
                continue;
            }
            used += tokens;
            keptDepth.push(item);
        }
        atDepth.length = 0;
        atDepth.push(...keptDepth);
    }
    const render = (entry) => {
        let content = options.variableContext ? renderVariables(entry.content, options.variableContext) : entry.content;
        content = renderNameMacros(content, options.charName ?? '', options.userName ?? '');
        return { ...entry, content };
    };
    const renderedPrepend = prepend.map(render);
    const renderedAppend = append.map(render);
    const renderedAtDepth = atDepth.map((item) => ({ ...item, entry: render(item.entry) }));
    const tokenEstimate = estimateTokens(`${buildInjection(renderedPrepend)}\n${buildInjection(renderedAppend)}`);
    return {
        scope: options.scope,
        prepend: renderedPrepend,
        append: renderedAppend,
        atDepth: renderedAtDepth,
        tokenEstimate,
        truncated,
        renderedPrepend: buildInjection(renderedPrepend),
        renderedAppend: buildInjection(renderedAppend),
        builtAt: new Date().toISOString(),
    };
}
