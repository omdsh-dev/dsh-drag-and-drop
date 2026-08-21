export declare const PLATFORM_MAX_CANDIDATES = 100;
export interface PlatformSearchHost {
    readonly platform: NodeJS.Platform;
    readonly home: string;
    commandExists(command: string): Promise<boolean>;
    exec(command: string, args: readonly string[]): Promise<string>;
    /** Raw (undecoded) stdout — es.exe and the PowerShell fallback emit the console's legacy code page (e.g. GBK), not UTF-8. */
    execBuffer(command: string, args: readonly string[]): Promise<Uint8Array>;
    windowsDrives(): Promise<readonly string[]>;
}
/**
 * es.exe and the PowerShell fallback print results using the console's active
 * code page — GBK on Chinese/Japanese Windows, UTF-8 on modern systems. UTF-8
 * decoding of GBK output mangles non-ASCII names (e.g. 新建.txt → �½�), which
 * breaks the exact basename match in validateCandidates. The search term is
 * known here, so decode both ways and keep the one that actually reproduces
 * the requested file name in the results; ties (pure-ASCII output) prefer UTF-8.
 */
export declare function decodeWindowsOutput(raw: Uint8Array, name: string): string;
export declare function indexedSearch(name: string, runtime?: PlatformSearchHost): Promise<string[]>;
export declare function broadSearchRoots(runtime?: PlatformSearchHost): Promise<string[]>;
