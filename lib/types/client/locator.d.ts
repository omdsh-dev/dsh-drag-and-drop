import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client';
import { type LocateResponse } from '../protocol.ts';
export declare function locateDroppedFile(file: File, workspaces: IWorkspaces, currentWorkspacePath: string | undefined): Promise<LocateResponse>;
