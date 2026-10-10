export const GENRES = [
    { id: 'fantasy', label: '玄幻', group: '奇幻武侠' },
    { id: 'xianxia', label: '仙侠', group: '奇幻武侠' },
    { id: 'wuxia', label: '武侠', group: '奇幻武侠' },
    { id: 'western', label: '西幻', group: '奇幻武侠' },
    { id: 'urban', label: '都市', group: '都市现实' },
    { id: 'realistic', label: '现实生活', group: '都市现实' },
    { id: 'campus', label: '青春校园', group: '都市现实' },
    { id: 'business', label: '商战职场', group: '都市现实' },
    { id: 'strategy', label: '权谋智斗', group: '都市现实' },
    { id: 'history', label: '历史架空', group: '历史军事' },
    { id: 'military', label: '军事战争', group: '历史军事' },
    { id: 'scifi', label: '科幻', group: '科幻灵异' },
    { id: 'mystery', label: '悬疑推理', group: '科幻灵异' },
    { id: 'horror', label: '灵异惊悚', group: '科幻灵异' },
    { id: 'apocalypse', label: '末世危机', group: '科幻灵异' },
    { id: 'romance', label: '现代言情', group: '情感' },
    { id: 'ancient-romance', label: '古代言情', group: '情感' },
    { id: 'game', label: '游戏', group: '竞技' },
    { id: 'sports', label: '体育竞技', group: '竞技' },
    { id: 'light-novel', label: '轻小说', group: '轻小说二次元' },
    { id: 'anime', label: '二次元', group: '轻小说二次元' },
    { id: 'fanfiction', label: '同人衍生', group: '轻小说二次元' },
    { id: 'honghuang', label: '洪荒封神', group: '流派向' },
    { id: 'farming', label: '种田文', group: '流派向' },
    { id: 'system', label: '系统流', group: '流派向' },
    { id: 'infinite', label: '无限流', group: '流派向' },
    { id: 'multiverse', label: '诸天万界', group: '流派向' },
];
const GENRE_LABEL_BY_ID = new Map(GENRES.map((genre) => [genre.id, genre.label]));
const GENRE_ID_BY_LABEL = new Map(GENRES.map((genre) => [genre.label.toLowerCase(), genre.id]));
export function genreLabel(id) {
    return GENRE_LABEL_BY_ID.get(String(id ?? '')) ?? String(id ?? '');
}
export function genreIdFromLabel(label) {
    return GENRE_ID_BY_LABEL.get(String(label ?? '').trim().toLowerCase());
}
export function isGenreId(id) {
    return GENRE_LABEL_BY_ID.has(String(id ?? ''));
}
