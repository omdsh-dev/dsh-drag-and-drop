import { FILE_DROP_ROUTE } from "../protocol.js";
import { droppedFileMeta, fullFingerprint, sampleFingerprint } from "./fingerprint.js";
async function request(body) {
    const response = await fetch(FILE_DROP_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const value = await response.json();
    return response.ok ? value : { status: 'error', message: value.status === 'error' ? value.message : `HTTP ${response.status}` };
}
export async function locateDroppedFile(file, workspaces, currentWorkspacePath) {
    const meta = droppedFileMeta(file);
    let result = await request({
        phase: 'metadata',
        file: meta,
        workspacePaths: workspaces.list.getSnapshot().items.map(item => item.path),
        ...(currentWorkspacePath === undefined ? {} : { currentWorkspacePath }),
    });
    if (result.status !== 'sample-required')
        return result;
    result = await request({
        phase: 'sample',
        file: meta,
        candidates: result.candidates,
        digest: await sampleFingerprint(file),
    });
    if (result.status !== 'full-required')
        return result;
    return request({
        phase: 'full',
        file: meta,
        candidates: result.candidates,
        digest: await fullFingerprint(file),
    });
}
