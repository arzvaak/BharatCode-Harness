export interface GenreOption {
    id: string;
    label: string;
    group: string;
}
export declare const GENRES: GenreOption[];
export declare function genreLabel(id: string): string;
export declare function genreIdFromLabel(label: string): string | undefined;
export declare function isGenreId(id: string): boolean;
