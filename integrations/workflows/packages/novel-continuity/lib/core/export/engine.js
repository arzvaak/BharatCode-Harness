export function formatChapter(chapter, content, format) {
    const body = content.trimEnd();
    switch (format) {
        case 'txt':
            return `${chapter.title}\n\n${body}`;
        case 'markdown':
            return `## 第 ${chapter.no} 章 ${chapter.title}\n\n${body}`;
        case 'platform':
            return `${chapter.title}\n\n${body}`;
    }
}
export function exportBook(chapters, options) {
    const parts = [];
    const titleLine = options.format === 'markdown'
        ? `# ${options.title}${options.author ? `\n\n> 作者：${options.author}` : ''}`
        : `${options.title}${options.author ? `\n作者：${options.author}` : ''}`;
    parts.push(titleLine);
    parts.push('');
    let lastVolume = '';
    for (const item of chapters) {
        if (options.splitVolumes) {
            const volumeMatch = /第\s*([^章]{1,8}?)\s*卷/.exec(item.chapter.title);
            const volume = volumeMatch?.[1];
            if (volume && volume !== lastVolume) {
                parts.push('');
                parts.push(`===== 第${volume}卷 =====`);
                parts.push('');
                lastVolume = volume;
            }
        }
        parts.push(formatChapter(item.chapter, item.content, options.format));
        if (options.authorNotes) {
            parts.push('');
            parts.push(options.authorNotes);
        }
        parts.push('');
    }
    return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}
export function platformChapter(chapter, content) {
    return `${chapter.title}\n${content.trimEnd()}`;
}
