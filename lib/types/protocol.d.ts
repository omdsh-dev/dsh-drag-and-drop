export declare const FILE_DROP_ROUTE = "/file-drop/locate";
export declare const SAMPLE_BYTES: number;
export declare const SMALL_FILE_BYTES: number;
export interface DroppedFileMeta {
    readonly name: string;
    readonly size: number;
    readonly lastModified: number;
}
export interface LocateRequest {
    readonly phase: 'metadata' | 'sample' | 'full';
    readonly file: DroppedFileMeta;
    readonly digest?: string;
    readonly candidates?: readonly string[];
    readonly workspacePaths?: readonly string[];
    readonly currentWorkspacePath?: string;
}
export type LocateResponse = {
    readonly status: 'found';
    readonly path: string;
} | {
    readonly status: 'sample-required';
    readonly candidates: readonly string[];
} | {
    readonly status: 'full-required';
    readonly candidates: readonly string[];
} | {
    readonly status: 'choose';
    readonly candidates: readonly string[];
} | {
    readonly status: 'not-found';
} | {
    readonly status: 'error';
    readonly message: string;
};
