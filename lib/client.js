window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-drag-and-drop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/chooser.ts
		function choosePath(name, candidates) {
			return new Promise((resolve) => {
				const backdrop = document.createElement("div");
				Object.assign(backdrop.style, {
					position: "fixed",
					inset: "0",
					zIndex: "2147483647",
					display: "grid",
					placeItems: "center",
					padding: "24px",
					background: "rgb(15 23 42 / 35%)"
				});
				const panel = document.createElement("div");
				Object.assign(panel.style, {
					width: "min(680px, 100%)",
					maxHeight: "min(560px, 80vh)",
					overflow: "auto",
					background: "#fff",
					color: "#0f172a",
					border: "1px solid #cbd5e1",
					borderRadius: "8px",
					boxShadow: "0 18px 48px rgb(15 23 42 / 28%)",
					padding: "20px",
					font: "14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif"
				});
				const title = document.createElement("h2");
				title.textContent = `选择 ${name} 的原始路径`;
				Object.assign(title.style, {
					margin: "0 0 14px",
					fontSize: "16px",
					letterSpacing: "0"
				});
				panel.append(title);
				const finish = (path) => {
					backdrop.remove();
					resolve(path);
				};
				for (const path of candidates) {
					const button = document.createElement("button");
					button.type = "button";
					button.textContent = path;
					Object.assign(button.style, {
						display: "block",
						width: "100%",
						margin: "8px 0",
						padding: "10px 12px",
						textAlign: "left",
						border: "1px solid #cbd5e1",
						borderRadius: "6px",
						background: "#f8fafc",
						color: "#0f172a",
						cursor: "pointer",
						overflowWrap: "anywhere",
						letterSpacing: "0"
					});
					button.addEventListener("click", () => {
						finish(path);
					});
					panel.append(button);
				}
				const cancel = document.createElement("button");
				cancel.type = "button";
				cancel.textContent = "取消";
				Object.assign(cancel.style, {
					marginTop: "10px",
					padding: "8px 12px",
					border: "1px solid #cbd5e1",
					borderRadius: "6px",
					background: "#fff",
					color: "#334155",
					cursor: "pointer",
					letterSpacing: "0"
				});
				cancel.addEventListener("click", () => {
					finish();
				});
				panel.append(cancel);
				backdrop.addEventListener("click", (event) => {
					if (event.target === backdrop) finish();
				});
				backdrop.append(panel);
				document.body.append(backdrop);
			});
		}
		//#endregion
		//#region src/protocol.ts
		const FILE_DROP_ROUTE = "/file-drop/locate";
		const SAMPLE_BYTES = 64 * 1024;
		//#endregion
		//#region src/client/fingerprint.ts
		function droppedFileMeta(file) {
			return {
				kind: "file",
				name: file.name,
				size: file.size,
				lastModified: file.lastModified
			};
		}
		function sampleRanges(size) {
			if (size <= 65536 * 3) return [{
				start: 0,
				end: size
			}];
			return [
				0,
				Math.max(0, Math.floor(size / 2) - Math.floor(SAMPLE_BYTES / 2)),
				size - SAMPLE_BYTES
			].map((start) => ({
				start,
				end: Math.min(start + SAMPLE_BYTES, size)
			}));
		}
		function hex(buffer) {
			return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
		}
		async function sampleFingerprint(file) {
			const ranges = sampleRanges(file.size);
			const parts = await Promise.all(ranges.map((range) => file.slice(range.start, range.end).arrayBuffer()));
			const total = parts.reduce((sum, part) => sum + part.byteLength, 8);
			const combined = new Uint8Array(total);
			new DataView(combined.buffer).setBigUint64(0, BigInt(file.size));
			let cursor = 8;
			for (const part of parts) {
				combined.set(new Uint8Array(part), cursor);
				cursor += part.byteLength;
			}
			return hex(await crypto.subtle.digest("SHA-256", combined));
		}
		async function fullFingerprint(file) {
			return hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
		}
		//#endregion
		//#region src/client/directory.ts
		function readFile(entry) {
			return new Promise((resolve, reject) => entry.file(resolve, reject));
		}
		async function readChildren(entry) {
			const reader = entry.createReader();
			const entries = [];
			while (true) {
				const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
				if (batch.length === 0) return entries;
				entries.push(...batch);
			}
		}
		function droppedDirectories(dataTransfer) {
			const directories = [];
			for (const [itemIndex, item] of [...dataTransfer.items].entries()) {
				const entry = item.webkitGetAsEntry?.();
				if (entry?.isDirectory === true) directories.push({
					itemIndex,
					name: entry.name,
					entry
				});
			}
			return directories;
		}
		async function readDirectoryStructure(root) {
			const entries = [];
			let truncated = false;
			const visit = async (directory, prefix, depth) => {
				if (depth >= 32) {
					truncated = true;
					return;
				}
				const children = await readChildren(directory);
				children.sort((a, b) => a.name.normalize("NFC").localeCompare(b.name.normalize("NFC")));
				for (const child of children) {
					if (entries.length >= 1e4) {
						truncated = true;
						return;
					}
					const path = prefix === "" ? child.name : `${prefix}/${child.name}`;
					if (child.isDirectory) {
						entries.push({
							path,
							kind: "directory"
						});
						await visit(child, path, depth + 1);
					} else if (child.isFile) {
						const file = await readFile(child);
						entries.push({
							path,
							kind: "file",
							size: file.size
						});
					}
				}
			};
			await visit(root, "", 0);
			return {
				entries,
				truncated
			};
		}
		async function findEntry(root, relativePath) {
			let current = root;
			for (const part of relativePath.split("/")) {
				if (!current.isDirectory) return void 0;
				current = (await readChildren(current)).find((entry) => entry.name.normalize("NFC") === part.normalize("NFC"));
				if (current === void 0) return void 0;
			}
			return current;
		}
		async function readDirectoryContentSamples(root, paths) {
			const samples = [];
			for (const path of paths) {
				const entry = await findEntry(root, path);
				if (entry?.isFile !== true) continue;
				const file = await readFile(entry);
				samples.push({
					path,
					size: file.size,
					digest: await sampleFingerprint(file)
				});
			}
			return samples;
		}
		//#endregion
		//#region src/client/drop-items.ts
		function droppedItems(dataTransfer) {
			const directories = droppedDirectories(dataTransfer);
			const directoryItemIndexes = new Set(directories.map((directory) => directory.itemIndex));
			return {
				directories,
				files: [...dataTransfer.items].flatMap((item, index) => {
					if (directoryItemIndexes.has(index) || item.kind !== "file") return [];
					const file = item.getAsFile();
					return file === null ? [] : [file];
				})
			};
		}
		//#endregion
		//#region src/client/locator.ts
		async function request(body) {
			const response = await fetch(FILE_DROP_ROUTE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			const value = await response.json();
			return response.ok ? value : {
				status: "error",
				message: value.status === "error" ? value.message : `HTTP ${response.status}`
			};
		}
		function workspaceContext(workspaces, currentWorkspacePath) {
			return {
				workspacePaths: workspaces.list.getSnapshot().items.map((item) => item.path),
				...currentWorkspacePath === void 0 ? {} : { currentWorkspacePath }
			};
		}
		async function locateDroppedFile(file, workspaces, currentWorkspacePath) {
			const meta = droppedFileMeta(file);
			let result = await request({
				phase: "metadata",
				file: meta,
				...workspaceContext(workspaces, currentWorkspacePath)
			});
			if (result.status !== "sample-required") return result;
			result = await request({
				phase: "sample",
				file: meta,
				candidates: result.candidates,
				digest: await sampleFingerprint(file)
			});
			if (result.status !== "full-required") return result;
			return request({
				phase: "full",
				file: meta,
				candidates: result.candidates,
				digest: await fullFingerprint(file)
			});
		}
		async function locateDroppedDirectory(directory, workspaces, currentWorkspacePath) {
			const initial = {
				kind: "directory",
				name: directory.name
			};
			let result = await request({
				phase: "metadata",
				file: initial,
				...workspaceContext(workspaces, currentWorkspacePath)
			});
			if (result.status !== "directory-structure-required") return result;
			const meta = {
				...initial,
				structure: await readDirectoryStructure(directory.entry)
			};
			result = await request({
				phase: "directory-structure",
				file: meta,
				candidates: result.candidates
			});
			if (result.status !== "directory-content-required") return result;
			return request({
				phase: "directory-content",
				file: meta,
				candidates: result.candidates,
				directorySamples: await readDirectoryContentSamples(directory.entry, result.paths)
			});
		}
		//#endregion
		//#region src/client/paths.ts
		/** Infer the host path syntax without relying on deprecated platform APIs alone. */
		function detectPathPlatform(navigatorValue = navigator) {
			const platform = navigatorValue.userAgentData?.platform ?? navigatorValue.platform;
			return /win/i.test(platform) ? "windows" : "posix";
		}
		function pathFromFileUrl(url, platform) {
			if (url.protocol !== "file:") return void 0;
			const pathname = decodeURIComponent(url.pathname);
			if (!pathname.startsWith("/") || pathname === "/") return void 0;
			if (platform === "posix") return url.host === "" || url.host === "localhost" ? pathname : void 0;
			if (url.host !== "" && url.host !== "localhost") return `\\\\${decodeURIComponent(url.host)}${pathname.replaceAll("/", "\\")}`;
			const drivePath = /^\/([A-Za-z]:)(\/.*)$/.exec(pathname);
			if (drivePath === null) return void 0;
			return `${drivePath[1]}${drivePath[2].replaceAll("/", "\\")}`;
		}
		/** Parse desktop file-manager URI payloads into unique native absolute paths. */
		function pathsFromUriList(value, platform = detectPathPlatform()) {
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const line of value.split(/\r?\n/)) {
				const candidate = line.trim();
				if (candidate === "" || candidate.startsWith("#")) continue;
				let url;
				try {
					url = new URL(candidate);
				} catch {
					continue;
				}
				const path = pathFromFileUrl(url, platform);
				if (path === void 0 || seen.has(path)) continue;
				seen.add(path);
				paths.push(path);
			}
			return paths;
		}
		/** Read the drag payload formats exposed by desktop file managers and browsers. */
		function pathsFromDrop(dataTransfer, platform = detectPathPlatform()) {
			const uriPaths = pathsFromUriList(dataTransfer.getData("text/uri-list"), platform);
			if (uriPaths.length > 0) return uriPaths;
			return pathsFromUriList(dataTransfer.getData("text/plain"), platform);
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"sessions",
			"workspaces",
			"conversation"
		];
		const OVERLAY_ID = "dsh-file-drop-overlay";
		function createFileIcon() {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 64 64");
			svg.setAttribute("aria-hidden", "true");
			svg.setAttribute("width", "64");
			svg.setAttribute("height", "64");
			svg.style.color = "var(--dsw-alias-state-business-primary, #3964fe)";
			svg.innerHTML = [
				"<path d=\"M18 7h19.2c1.8 0 3.5.7 4.8 2l9 9c1.3 1.3 2 3 2 4.8V49a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V15a8 8 0 0 1 8-8Z\" fill=\"currentColor\"/>",
				"<path d=\"M37 7.1V18a5 5 0 0 0 5 5h10.9c-.1-1.9-.8-3.6-2.1-4.9l-8.9-9A7.1 7.1 0 0 0 37 7.1Z\" fill=\"rgb(255 255 255 / 38%)\"/>",
				"<path d=\"M21 32h22M21 40h22M21 48h14\" fill=\"none\" stroke=\"white\" stroke-width=\"3.2\" stroke-linecap=\"round\" opacity=\".92\"/>"
			].join("");
			return svg;
		}
		function createOverlay() {
			const root = document.createElement("div");
			root.id = OVERLAY_ID;
			root.setAttribute("role", "status");
			root.setAttribute("aria-live", "polite");
			Object.assign(root.style, {
				position: "fixed",
				inset: "0",
				zIndex: "2147483647",
				display: "grid",
				placeItems: "center",
				padding: "24px",
				pointerEvents: "none",
				opacity: "0",
				visibility: "hidden",
				transition: "opacity 140ms ease, visibility 140ms ease",
				background: "rgb(15 23 42 / 44%)",
				backdropFilter: "blur(8px)",
				WebkitBackdropFilter: "blur(8px)"
			});
			const panel = document.createElement("div");
			Object.assign(panel.style, {
				display: "grid",
				justifyItems: "center",
				gap: "14px",
				minWidth: "260px",
				padding: "28px 36px",
				color: "#ffffff",
				font: "600 16px/1.4 -apple-system, BlinkMacSystemFont, sans-serif",
				letterSpacing: "0"
			});
			panel.append(createFileIcon());
			const label = document.createElement("span");
			label.textContent = "松开鼠标以插入文件路径";
			panel.append(label);
			root.append(panel);
			document.body.append(root);
			return {
				setActive(active) {
					root.style.opacity = active ? "1" : "0";
					root.style.visibility = active ? "visible" : "hidden";
				},
				dispose() {
					root.remove();
				}
			};
		}
		function hasFilePayload(event) {
			const types = event.dataTransfer?.types ?? [];
			return types.includes("Files") || types.includes("text/uri-list");
		}
		function currentInput(ctx) {
			const sessionId = ctx.sessions.list.getSnapshot().current;
			if (sessionId === void 0) return void 0;
			const scope = ctx.sessions.scope(sessionId);
			const conversation = ctx.get("conversation");
			return scope === void 0 || conversation === void 0 ? void 0 : conversation.input.for(scope);
		}
		function currentWorkspacePath(ctx) {
			const sessionId = ctx.sessions.list.getSnapshot().current;
			return sessionId === void 0 ? void 0 : ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
		}
		function appendPaths(input, paths) {
			const draft = input.state.getSnapshot().draft;
			const text = paths.join("\n");
			input.setDraft(draft === "" ? text : `${draft}\n${text}`);
		}
		async function resolveDrop(ctx, dataTransfer) {
			const input = currentInput(ctx);
			if (input === void 0) return;
			const direct = pathsFromDrop(dataTransfer);
			if (direct.length > 0) {
				appendPaths(input, direct);
				return;
			}
			const { directories, files } = droppedItems(dataTransfer);
			const entries = [...directories.map((directory) => ({
				name: directory.name,
				locate: () => locateDroppedDirectory(directory, ctx.workspaces, currentWorkspacePath(ctx))
			})), ...files.map((file) => ({
				name: file.name,
				locate: () => locateDroppedFile(file, ctx.workspaces, currentWorkspacePath(ctx))
			}))];
			const found = [];
			const failures = [];
			for (const entry of entries) try {
				const result = await entry.locate();
				if (result.status === "found") found.push(result.path);
				else if (result.status === "choose") {
					const selected = await choosePath(entry.name, result.candidates);
					if (selected === void 0) failures.push(entry.name);
					else found.push(selected);
				} else if (result.status === "error") failures.push(`${entry.name}（${result.message}）`);
				else failures.push(entry.name);
			} catch (error) {
				failures.push(`${entry.name}（${error instanceof Error ? error.message : String(error)}）`);
			}
			if (found.length > 0) appendPaths(input, found);
			if (failures.length > 0) input.notify("error", `未能定位原始路径：${failures.join("、")}`);
		}
		function apply(ctx) {
			let dragDepth = 0;
			const overlay = createOverlay();
			const onDragEnter = (event) => {
				if (!hasFilePayload(event)) return;
				dragDepth += 1;
				overlay.setActive(true);
			};
			const onDragOver = (event) => {
				if (!hasFilePayload(event)) return;
				event.preventDefault();
				if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
				overlay.setActive(true);
			};
			const onDragLeave = (event) => {
				if (!hasFilePayload(event)) return;
				dragDepth = Math.max(0, dragDepth - 1);
				if (dragDepth === 0) overlay.setActive(false);
			};
			const onDrop = (event) => {
				if (!hasFilePayload(event)) return;
				event.preventDefault();
				dragDepth = 0;
				overlay.setActive(false);
				if (event.dataTransfer !== null) resolveDrop(ctx, event.dataTransfer);
			};
			window.addEventListener("dragenter", onDragEnter);
			window.addEventListener("dragover", onDragOver);
			window.addEventListener("dragleave", onDragLeave);
			window.addEventListener("drop", onDrop);
			ctx.effect(() => () => {
				window.removeEventListener("dragenter", onDragEnter);
				window.removeEventListener("dragover", onDragOver);
				window.removeEventListener("dragleave", onDragLeave);
				window.removeEventListener("drop", onDrop);
				overlay.dispose();
			}, "file-drop: global drag listeners");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.pathsFromDrop = pathsFromDrop;
		exports.pathsFromUriList = pathsFromUriList;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map