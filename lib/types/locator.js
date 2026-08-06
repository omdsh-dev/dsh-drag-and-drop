import { homedir } from 'node:os';
import { basename, join, normalize } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { directoryContentDigest, directoryStructureDigest, selectDirectorySamplePaths } from "./directory.js";
import { nodeDirectoryContentDigest, nodeDirectoryStructureDigest } from "./directory-node.js";
import { fullFingerprint, sampleFingerprint } from "./fingerprint.js";
import { broadSearchRoots, indexedSearch } from "./platform-search.js";
import { SMALL_FILE_BYTES } from "./protocol.js";
const MAX_CANDIDATES = 100;
const MAX_WALK_ENTRIES = 20_000;
const WALK_DEPTH = 12;
async function directCandidate(root, name, kind) {
    const path = join(root, name);
    try {
        const info = await stat(path);
        return (kind === 'file' ? info.isFile() : info.isDirectory()) ? path : undefined;
    }
    catch {
        return undefined;
    }
}
async function walkByName(root, name, kind, depth = WALK_DEPTH) {
    const found = [];
    let visited = 0;
    const visit = async (directory, remaining) => {
        if (remaining < 0 || found.length >= MAX_CANDIDATES || visited >= MAX_WALK_ENTRIES)
            return;
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (++visited >= MAX_WALK_ENTRIES || found.length >= MAX_CANDIDATES)
                break;
            const path = join(directory, entry.name);
            if (entry.name === name && (kind === 'file' ? entry.isFile() : entry.isDirectory()))
                found.push(path);
            if (entry.isDirectory() && !entry.isSymbolicLink())
                await visit(path, remaining - 1);
        }
    };
    await visit(root, depth);
    return found;
}
async function validateCandidates(item, paths) {
    const candidates = [];
    for (const path of [...new Set(paths)].slice(0, MAX_CANDIDATES)) {
        try {
            const info = await stat(path);
            const kindMatches = item.kind === 'file' ? info.isFile() && info.size === item.size : info.isDirectory();
            if (kindMatches && basename(path) === item.name)
                candidates.push({ path: normalize(path), mtimeMs: info.mtimeMs });
        }
        catch { /* Candidate disappeared between lookup and validation. */ }
    }
    return candidates.sort((a, b) => item.kind === 'file'
        ? Math.abs(a.mtimeMs - item.lastModified) - Math.abs(b.mtimeMs - item.lastModified) || a.path.localeCompare(b.path)
        : a.path.localeCompare(b.path));
}
async function searchRoots(item, roots) {
    const paths = [];
    for (const root of roots) {
        const direct = await directCandidate(root, item.name, item.kind);
        if (direct !== undefined)
            paths.push(direct);
        paths.push(...await walkByName(root, item.name, item.kind));
    }
    return validateCandidates(item, paths);
}
async function metadataCandidates(item, request) {
    const current = request.currentWorkspacePath;
    const workspaceRoots = [...new Set(request.workspacePaths ?? [])].filter(root => typeof root === 'string' && root !== '');
    if (current !== undefined) {
        const candidates = await searchRoots(item, [current]);
        if (candidates.length > 0)
            return candidates;
    }
    const otherWorkspaces = workspaceRoots.filter(root => root !== current);
    if (otherWorkspaces.length > 0) {
        const candidates = await searchRoots(item, otherWorkspaces);
        if (candidates.length > 0)
            return candidates;
    }
    const common = await searchRoots(item, [join(homedir(), 'Desktop'), join(homedir(), 'Documents'), join(homedir(), 'Downloads')]);
    if (common.length > 0)
        return common;
    const indexed = await validateCandidates(item, await indexedSearch(item.name));
    if (indexed.length > 0)
        return indexed;
    return searchRoots(item, await broadSearchRoots());
}
async function matchingFileDigest(candidates, digest, phase, file) {
    const matched = [];
    for (const path of candidates.slice(0, MAX_CANDIDATES)) {
        try {
            const actual = phase === 'sample' ? await sampleFingerprint(path, file.size) : await fullFingerprint(path);
            if (actual === digest)
                matched.push(path);
        }
        catch { /* Unreadable candidates are not matches. */ }
    }
    return matched;
}
async function locateDirectory(request) {
    if (request.file.kind !== 'directory')
        return { status: 'error', message: 'directory phase requires directory metadata' };
    const candidates = request.candidates ?? (await metadataCandidates(request.file, request)).map(candidate => candidate.path);
    if (candidates.length === 0)
        return { status: 'not-found' };
    const expected = directoryStructureDigest(request.file.structure);
    const matched = [];
    let samplePaths = selectDirectorySamplePaths(request.file.structure.entries);
    for (const path of candidates) {
        try {
            const actual = await nodeDirectoryStructureDigest(path);
            if (actual.digest === expected) {
                matched.push(path);
                samplePaths = actual.paths;
            }
        }
        catch { /* Ignore unreadable directories. */ }
    }
    if (matched.length === 0)
        return { status: 'not-found' };
    if (matched.length === 1)
        return { status: 'found', path: matched[0] };
    if (samplePaths.length === 0)
        return { status: 'choose', candidates: matched };
    return { status: 'directory-content-required', candidates: matched, paths: samplePaths };
}
export async function locate(request) {
    if (request.file.name === '')
        return { status: 'error', message: 'invalid dropped entry metadata' };
    if (request.file.kind === undefined) {
        request = { ...request, file: { ...request.file, kind: 'file' } };
    }
    if (request.file.kind === 'directory') {
        if (request.phase === 'metadata' || request.phase === 'directory-structure')
            return locateDirectory(request);
        if (request.phase !== 'directory-content' || request.candidates === undefined || request.directorySamples === undefined) {
            return { status: 'error', message: 'invalid directory phase' };
        }
        const expected = directoryContentDigest(request.directorySamples);
        const paths = request.directorySamples.map(sample => sample.path);
        const matched = [];
        for (const path of request.candidates.slice(0, MAX_CANDIDATES)) {
            try {
                if (await nodeDirectoryContentDigest(path, paths) === expected)
                    matched.push(path);
            }
            catch { /* Ignore unreadable directories. */ }
        }
        if (matched.length === 0)
            return { status: 'not-found' };
        if (matched.length === 1)
            return { status: 'found', path: matched[0] };
        return { status: 'choose', candidates: matched };
    }
    if (!Number.isSafeInteger(request.file.size) || request.file.size < 0)
        return { status: 'error', message: 'invalid dropped-file metadata' };
    if (request.phase === 'metadata') {
        const candidates = await metadataCandidates(request.file, request);
        if (candidates.length === 0)
            return { status: 'not-found' };
        if (candidates.length === 1)
            return { status: 'found', path: candidates[0].path };
        return { status: 'sample-required', candidates: candidates.map(candidate => candidate.path) };
    }
    if ((request.phase !== 'sample' && request.phase !== 'full') || request.digest === undefined || request.candidates === undefined) {
        return { status: 'error', message: 'digest phase requires candidates and digest' };
    }
    const matched = await matchingFileDigest(request.candidates, request.digest, request.phase, request.file);
    if (matched.length === 0)
        return { status: 'not-found' };
    if (matched.length === 1)
        return { status: 'found', path: matched[0] };
    if (request.phase === 'sample' && request.file.size <= SMALL_FILE_BYTES)
        return { status: 'choose', candidates: matched };
    if (request.phase === 'sample')
        return { status: 'full-required', candidates: matched };
    return { status: 'choose', candidates: matched };
}
