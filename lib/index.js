import { homedir, platform } from "node:os";
import { basename, join, normalize } from "node:path";
import { access, constants, open, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
//#region lib/types/protocol.js
const FILE_DROP_ROUTE = "/file-drop/locate";
const SAMPLE_BYTES = 64 * 1024;
//#endregion
//#region lib/types/fingerprint.js
function sampleRanges(size) {
	if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("size must be a non-negative safe integer");
	if (size <= 65536 * 3) return [{
		start: 0,
		length: size
	}];
	return [
		0,
		Math.max(0, Math.floor(size / 2) - Math.floor(SAMPLE_BYTES / 2)),
		size - SAMPLE_BYTES
	].map((start) => ({
		start,
		length: Math.min(SAMPLE_BYTES, size - start)
	}));
}
function hashParts(size, parts) {
	const hash = createHash("sha256");
	const header = Buffer.allocUnsafe(8);
	header.writeBigUInt64BE(BigInt(size));
	hash.update(header);
	for (const part of parts) hash.update(part);
	return hash.digest("hex");
}
async function sampleFingerprint(path, size) {
	const handle = await open(path, "r");
	try {
		const parts = [];
		for (const range of sampleRanges(size)) {
			const buffer = Buffer.allocUnsafe(range.length);
			const { bytesRead } = await handle.read(buffer, 0, range.length, range.start);
			parts.push(buffer.subarray(0, bytesRead));
		}
		return hashParts(size, parts);
	} finally {
		await handle.close();
	}
}
async function fullFingerprint(path) {
	const handle = await open(path, "r");
	try {
		const hash = createHash("sha256");
		const buffer = Buffer.allocUnsafe(256 * 1024);
		let position = 0;
		while (true) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		return hash.digest("hex");
	} finally {
		await handle.close();
	}
}
//#endregion
//#region lib/types/platform-search.js
const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 3e3;
const host = {
	platform: platform(),
	home: homedir(),
	async commandExists(command) {
		if (command.includes("/") || command.includes("\\")) try {
			await access(command, constants.X_OK);
			return true;
		} catch {
			return false;
		}
		const probe = platform() === "win32" ? "where.exe" : "/usr/bin/env";
		const args = platform() === "win32" ? [command] : [
			"sh",
			"-c",
			"command -v \"$1\" >/dev/null 2>&1",
			"sh",
			command
		];
		try {
			await execFileAsync(probe, args, { timeout: 1e3 });
			return true;
		} catch {
			return false;
		}
	},
	async exec(command, args) {
		const { stdout } = await execFileAsync(command, [...args], {
			timeout: COMMAND_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
			windowsHide: true
		});
		return stdout;
	},
	async windowsDrives() {
		try {
			return (await this.exec("powershell.exe", [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"[System.IO.DriveInfo]::GetDrives() | Where-Object {$_.DriveType -eq \"Fixed\" -and $_.IsReady} | ForEach-Object {$_.RootDirectory.FullName}"
			])).split(/\r?\n/).filter(Boolean);
		} catch {
			return [];
		}
	}
};
function lines(value) {
	return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 100);
}
async function macSearch(name, runtime) {
	const escaped = name.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
	try {
		return lines(await runtime.exec("/usr/bin/mdfind", [`kMDItemFSName == "${escaped}"c`]));
	} catch {
		return [];
	}
}
async function linuxSearch(name, runtime) {
	for (const command of ["plocate", "locate"]) {
		if (!await runtime.commandExists(command)) continue;
		try {
			return lines(await runtime.exec(command, [
				"--basename",
				"--limit",
				String(400),
				name
			])).filter((path) => path.split("/").at(-1) === name).slice(0, 100);
		} catch {}
	}
	return [];
}
function powershellLiteral(value) {
	return `'${value.replaceAll("'", "''")}'`;
}
async function windowsSearch(name, runtime) {
	for (const command of ["es.exe", "Everything.exe"]) {
		if (!await runtime.commandExists(command)) continue;
		try {
			return lines(await runtime.exec(command, [
				"-n",
				String(100),
				"-whole-filename",
				name
			]));
		} catch {}
	}
	if (!await runtime.commandExists("powershell.exe")) return [];
	const roots = [runtime.home, ...await runtime.windowsDrives()];
	const script = [
		`$name=${powershellLiteral(name)}`,
		`$roots=@(${roots.map(powershellLiteral).join(",")}) | Select-Object -Unique`,
		`$roots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter $name -File -Recurse -Force -ErrorAction SilentlyContinue }`,
		`| Select-Object -First ${String(100)} -ExpandProperty FullName`
	].join(" ");
	try {
		return lines(await runtime.exec("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			script
		]));
	} catch {
		return [];
	}
}
async function indexedSearch(name, runtime = host) {
	if (runtime.platform === "darwin") return macSearch(name, runtime);
	if (runtime.platform === "linux") return linuxSearch(name, runtime);
	if (runtime.platform === "win32") return windowsSearch(name, runtime);
	return [];
}
async function broadSearchRoots(runtime = host) {
	if (runtime.platform === "linux") {
		const roots = [runtime.home];
		for (const parent of ["/mnt", "/media"]) try {
			for (const entry of await readdir(parent, { withFileTypes: true })) if (entry.isDirectory()) roots.push(join(parent, entry.name));
		} catch {}
		return roots;
	}
	if (runtime.platform === "win32") return [runtime.home, ...await runtime.windowsDrives()];
	return [];
}
//#endregion
//#region lib/types/locator.js
const MAX_CANDIDATES = 100;
const MAX_WALK_ENTRIES = 2e4;
const WALK_DEPTH = 12;
async function directCandidate(root, name) {
	const path = join(root, name);
	try {
		return (await stat(path)).isFile() ? path : void 0;
	} catch {
		return;
	}
}
async function walkByName(root, name, depth = WALK_DEPTH) {
	const found = [];
	let visited = 0;
	const visit = async (directory, remaining) => {
		if (remaining < 0 || found.length >= MAX_CANDIDATES || visited >= MAX_WALK_ENTRIES) return;
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (++visited >= MAX_WALK_ENTRIES || found.length >= MAX_CANDIDATES) break;
			const path = join(directory, entry.name);
			if (entry.isFile() && entry.name === name) found.push(path);
			else if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(path, remaining - 1);
		}
	};
	await visit(root, depth);
	return found;
}
async function validateCandidates(file, paths, rank) {
	const candidates = [];
	for (const path of [...new Set(paths)].slice(0, MAX_CANDIDATES)) try {
		const info = await stat(path);
		if (info.isFile() && basename(path) === file.name && info.size === file.size) candidates.push({
			path: normalize(path),
			mtimeMs: info.mtimeMs,
			rank
		});
	} catch {}
	return candidates.sort((a, b) => Math.abs(a.mtimeMs - file.lastModified) - Math.abs(b.mtimeMs - file.lastModified) || a.path.localeCompare(b.path));
}
async function searchRoots(file, roots, rank) {
	const paths = [];
	for (const root of roots) {
		const direct = await directCandidate(root, file.name);
		if (direct !== void 0) paths.push(direct);
		paths.push(...await walkByName(root, file.name));
	}
	return validateCandidates(file, paths, rank);
}
async function metadataCandidates(file, request) {
	const current = request.currentWorkspacePath;
	const workspaceRoots = [...new Set(request.workspacePaths ?? [])].filter((root) => typeof root === "string" && root !== "");
	if (current !== void 0) {
		const candidates = await searchRoots(file, [current], 100);
		if (candidates.length > 0) return candidates;
	}
	const otherWorkspaces = workspaceRoots.filter((root) => root !== current);
	if (otherWorkspaces.length > 0) {
		const candidates = await searchRoots(file, otherWorkspaces, 70);
		if (candidates.length > 0) return candidates;
	}
	const common = await searchRoots(file, [
		join(homedir(), "Desktop"),
		join(homedir(), "Documents"),
		join(homedir(), "Downloads")
	], 40);
	if (common.length > 0) return common;
	const indexed = await validateCandidates(file, await indexedSearch(file.name), 20);
	if (indexed.length > 0) return indexed;
	return searchRoots(file, await broadSearchRoots(), 10);
}
async function matchingDigest(candidates, digest, phase, size) {
	const matched = [];
	for (const path of candidates.slice(0, MAX_CANDIDATES)) try {
		if ((phase === "sample" ? await sampleFingerprint(path, size) : await fullFingerprint(path)) === digest) matched.push(path);
	} catch {}
	return matched;
}
async function locate(request) {
	if (request.file.name === "" || !Number.isSafeInteger(request.file.size) || request.file.size < 0) return {
		status: "error",
		message: "invalid dropped-file metadata"
	};
	if (request.phase === "metadata") {
		const candidates = await metadataCandidates(request.file, request);
		if (candidates.length === 0) return { status: "not-found" };
		if (candidates.length === 1) return {
			status: "found",
			path: candidates[0].path
		};
		return {
			status: "sample-required",
			candidates: candidates.map((candidate) => candidate.path)
		};
	}
	if (request.digest === void 0 || request.candidates === void 0) return {
		status: "error",
		message: "digest phase requires candidates and digest"
	};
	const matched = await matchingDigest(request.candidates, request.digest, request.phase, request.file.size);
	if (matched.length === 0) return { status: "not-found" };
	if (matched.length === 1) return {
		status: "found",
		path: matched[0]
	};
	if (request.phase === "sample" && request.file.size <= 8388608) return {
		status: "choose",
		candidates: matched
	};
	if (request.phase === "sample") return {
		status: "full-required",
		candidates: matched
	};
	return {
		status: "choose",
		candidates: matched
	};
}
//#endregion
//#region lib/types/index.js
const inject = ["httpServer"];
const MAX_BODY_BYTES = 256 * 1024;
async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new Error("request body too large");
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(body));
}
function apply(ctx) {
	ctx.effect(() => ctx.httpServer.register({
		kind: "exact",
		path: FILE_DROP_ROUTE,
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendJson(res, 405, {
					status: "error",
					message: "method not allowed"
				});
				return;
			}
			try {
				sendJson(res, 200, await locate(await readJson(req)));
			} catch (error) {
				sendJson(res, 400, {
					status: "error",
					message: error instanceof Error ? error.message : String(error)
				});
			}
		}
	}), "file-drop: locator route");
}
//#endregion
export { apply, inject };
