const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const SENTENCE_END_RE = /[。！？!?；;]/g;
const OPEN_QUOTES = new Set(['“', '「', '『']);
const CLOSE_QUOTES = new Set(['”', '」', '』']);
export function countChapter(text, chapterNo) {
    const totalChars = text.length;
    let cjkChars = 0;
    let paragraphs = 0;
    let inQuote = false;
    let quoteChars = 0;
    for (const char of text) {
        if (CJK_RE.test(char))
            cjkChars += 1;
        if (char === '"') {
            inQuote = !inQuote;
            continue;
        }
        if (OPEN_QUOTES.has(char)) {
            inQuote = true;
            continue;
        }
        if (CLOSE_QUOTES.has(char)) {
            inQuote = false;
            continue;
        }
        if (inQuote)
            quoteChars += 1;
    }
    for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0)
            paragraphs += 1;
    }
    const dialogueRatio = totalChars > 0 ? Math.min(1, quoteChars / totalChars) : 0;
    const sentences = text.split(SENTENCE_END_RE).map((s) => s.trim()).filter((s) => s.length > 0);
    const avgSentenceLen = sentences.length > 0
        ? sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
        : 0;
    return {
        chapterNo,
        totalChars,
        cjkChars,
        paragraphs,
        dialogueRatio: round3(dialogueRatio),
        avgSentenceLen: round1(avgSentenceLen),
        meetsTarget: false,
    };
}
export function checkWordTarget(stats, min, max, useCjk = false) {
    const count = useCjk ? stats.cjkChars : stats.totalChars;
    return { ...stats, meetsTarget: count >= min && count <= max };
}
function round3(value) {
    return Math.round(value * 1000) / 1000;
}
function round1(value) {
    return Math.round(value * 10) / 10;
}
