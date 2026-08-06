import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { FILE_DROP_ROUTE, type LocateRequest, type LocateResponse } from '../protocol.ts'
import { droppedFileMeta, fullFingerprint, sampleFingerprint } from './fingerprint.ts'

async function request(body: LocateRequest): Promise<LocateResponse> {
  const response = await fetch(FILE_DROP_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await response.json() as LocateResponse
  return response.ok ? value : { status: 'error', message: value.status === 'error' ? value.message : `HTTP ${response.status}` }
}

export async function locateDroppedFile(
  file: File,
  workspaces: IWorkspaces,
  currentWorkspacePath: string | undefined,
): Promise<LocateResponse> {
  const meta = droppedFileMeta(file)
  let result = await request({
    phase: 'metadata',
    file: meta,
    workspacePaths: workspaces.list.getSnapshot().items.map(item => item.path),
    ...(currentWorkspacePath === undefined ? {} : { currentWorkspacePath }),
  })
  if (result.status !== 'sample-required') return result

  result = await request({
    phase: 'sample',
    file: meta,
    candidates: result.candidates,
    digest: await sampleFingerprint(file),
  })
  if (result.status !== 'full-required') return result

  return request({
    phase: 'full',
    file: meta,
    candidates: result.candidates,
    digest: await fullFingerprint(file),
  })
}
