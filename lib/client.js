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
		async function locateDroppedFile(file, workspaces, currentWorkspacePath) {
			const meta = droppedFileMeta(file);
			let result = await request({
				phase: "metadata",
				file: meta,
				workspacePaths: workspaces.list.getSnapshot().items.map((item) => item.path),
				...currentWorkspacePath === void 0 ? {} : { currentWorkspacePath }
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
			const files = [...dataTransfer.files];
			const found = [];
			const missed = [];
			for (const file of files) try {
				const result = await locateDroppedFile(file, ctx.workspaces, currentWorkspacePath(ctx));
				if (result.status === "found") found.push(result.path);
				else if (result.status === "choose") {
					const selected = await choosePath(file.name, result.candidates);
					if (selected === void 0) missed.push(file.name);
					else found.push(selected);
				} else if (result.status === "error") {
					input.notify("error", `定位 ${file.name} 失败：${result.message}`);
					missed.push(file.name);
				} else missed.push(file.name);
			} catch (error) {
				input.notify("error", `定位 ${file.name} 失败：${error instanceof Error ? error.message : String(error)}`);
				missed.push(file.name);
			}
			if (found.length > 0) appendPaths(input, found);
			if (missed.length > 0) input.notify("error", `未能定位原始路径：${missed.join("、")}`);
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