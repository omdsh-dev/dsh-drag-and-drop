import { homedir } from 'node:os'
import { basename, join, normalize } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { fullFingerprint, sampleFingerprint } from './fingerprint.ts'
import { broadSearchRoots, indexedSearch } from './platform-search.ts'
import type { DroppedFileMeta, LocateRequest, LocateResponse } from './protocol.ts'
import { SMALL_FILE_BYTES } from './protocol.ts'

const MAX_CANDIDATES = 100
const MAX_WALK_ENTRIES = 20_000
const WALK_DEPTH = 12

interface Candidate {
  readonly path: string
  readonly mtimeMs: number
  readonly rank: number
}

async function directCandidate(root: string, name: string): Promise<string | undefined> {
  const path = join(root, name)
  try {
    return (await stat(path)).isFile() ? path : undefined
  } catch {
    return undefined
  }
}

async function walkByName(root: string, name: string, depth = WALK_DEPTH): Promise<string[]> {
  const found: string[] = []
  let visited = 0
  const visit = async (directory: string, remaining: number): Promise<void> => {
    if (remaining < 0 || found.length >= MAX_CANDIDATES || visited >= MAX_WALK_ENTRIES) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (++visited >= MAX_WALK_ENTRIES || found.length >= MAX_CANDIDATES) break
      const path = join(directory, entry.name)
      if (entry.isFile() && entry.name === name) found.push(path)
      else if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(path, remaining - 1)
    }
  }
  await visit(root, depth)
  return found
}

async function validateCandidates(file: DroppedFileMeta, paths: readonly string[], rank: number): Promise<Candidate[]> {
  const candidates: Candidate[] = []
  for (const path of [...new Set(paths)].slice(0, MAX_CANDIDATES)) {
    try {
      const info = await stat(path)
      if (info.isFile() && basename(path) === file.name && info.size === file.size) {
        candidates.push({ path: normalize(path), mtimeMs: info.mtimeMs, rank })
      }
    } catch {
      // Candidate disappeared between lookup and validation.
    }
  }
  return candidates.sort((a, b) => Math.abs(a.mtimeMs - file.lastModified) - Math.abs(b.mtimeMs - file.lastModified) || a.path.localeCompare(b.path))
}

async function searchRoots(file: DroppedFileMeta, roots: readonly string[], rank: number): Promise<Candidate[]> {
  const paths: string[] = []
  for (const root of roots) {
    const direct = await directCandidate(root, file.name)
    if (direct !== undefined) paths.push(direct)
    paths.push(...await walkByName(root, file.name))
  }
  return validateCandidates(file, paths, rank)
}

async function metadataCandidates(file: DroppedFileMeta, request: LocateRequest): Promise<Candidate[]> {
  const current = request.currentWorkspacePath
  const workspaceRoots = [...new Set(request.workspacePaths ?? [])].filter(root => typeof root === 'string' && root !== '')

  if (current !== undefined) {
    const candidates = await searchRoots(file, [current], 100)
    if (candidates.length > 0) return candidates
  }

  const otherWorkspaces = workspaceRoots.filter(root => root !== current)
  if (otherWorkspaces.length > 0) {
    const candidates = await searchRoots(file, otherWorkspaces, 70)
    if (candidates.length > 0) return candidates
  }

  const commonRoots = [join(homedir(), 'Desktop'), join(homedir(), 'Documents'), join(homedir(), 'Downloads')]
  const common = await searchRoots(file, commonRoots, 40)
  if (common.length > 0) return common

  const indexed = await validateCandidates(file, await indexedSearch(file.name), 20)
  if (indexed.length > 0) return indexed

  return searchRoots(file, await broadSearchRoots(), 10)
}

async function matchingDigest(candidates: readonly string[], digest: string, phase: 'sample' | 'full', size: number): Promise<string[]> {
  const matched: string[] = []
  for (const path of candidates.slice(0, MAX_CANDIDATES)) {
    try {
      const actual = phase === 'sample' ? await sampleFingerprint(path, size) : await fullFingerprint(path)
      if (actual === digest) matched.push(path)
    } catch {
      // Unreadable candidates are not matches.
    }
  }
  return matched
}

export async function locate(request: LocateRequest): Promise<LocateResponse> {
  if (request.file.name === '' || !Number.isSafeInteger(request.file.size) || request.file.size < 0) {
    return { status: 'error', message: 'invalid dropped-file metadata' }
  }

  if (request.phase === 'metadata') {
    const candidates = await metadataCandidates(request.file, request)
    if (candidates.length === 0) return { status: 'not-found' }
    if (candidates.length === 1) return { status: 'found', path: candidates[0].path }
    return { status: 'sample-required', candidates: candidates.map(candidate => candidate.path) }
  }

  if (request.digest === undefined || request.candidates === undefined) {
    return { status: 'error', message: 'digest phase requires candidates and digest' }
  }
  const matched = await matchingDigest(request.candidates, request.digest, request.phase, request.file.size)
  if (matched.length === 0) return { status: 'not-found' }
  if (matched.length === 1) return { status: 'found', path: matched[0] }
  if (request.phase === 'sample' && request.file.size <= SMALL_FILE_BYTES) return { status: 'choose', candidates: matched }
  if (request.phase === 'sample') return { status: 'full-required', candidates: matched }
  return { status: 'choose', candidates: matched }
}
