# dsh-drag-and-drop — Drag-and-drop file path plugin

[English](README.en.md) | [中文](README.md)

A DeepSeek Harness Web UI plugin: drag files onto any part of the page and the file’s original absolute path is inserted into the current conversation input.

The plugin never uploads, moves, or copies files, and it never breaks the relationship between a file and its neighboring dependency files.

License BSD-3-Clause · [GitHub](https://github.com/bill9109/dsh-drag-and-drop)

## Features

- Drag files onto any part of the Web UI to insert their original absolute paths
- Full-page dim + blur hint while dragging
- Supports files and folders; drag multiple items at once — one path per line
- Native paths on macOS, Linux, and Windows
- POSIX paths, Windows drive-letter paths, and UNC network paths
- No uploading, moving, or copying of files
- Locates files in the current Workspace and registered Workspaces first
- When the browser hides the original path, uses the local file index and bounded directory search
- Computes content fingerprints only when multiple candidates exist
- When several byte-identical copies cannot be told apart automatically, lets the user pick the path
- Failed lookups surface as a dismissible plugin toast (auto-dismisses after 8s; hovering pauses the timer)
- Writes the draft via DSH’s input-state service instead of touching the input DOM

## Install

This plugin is a DSH **bundle** (`package.json` declares `dsh.bundle` + `dsh.client`).
Install it into a profile with the standard `dsh plugin` mechanism — **no DSH source changes and no `config.yaml` needed**.

> The old README’s `pnpm --filter @deepseek-ai/dsh add ...` + `config.yaml` flow is obsolete: under the official profile/bundle model `config.yaml` is no longer read.

### 1. Add to a profile (standard)

Install into the official `web` profile (which ships the `dsh-base` + `dsh-web-app` layers; the plugin needs the `webServer` service provided by web-app):

```sh
dsh plugin --profile web add github:bill9109/dsh-drag-and-drop
# or from a local checkout:
dsh plugin --profile web add /path/to/dsh-drag-and-drop
```

The repository ships its build output (`lib/` is committed) — no build step needed after installing.

### 2. Restart the Web UI

Restart DSH Web UI the way you normally start it, then refresh the browser page. The plugin appears in the browser boot manifest (`__DSH_BOOT__`) and its client bundle loads automatically.

## Usage

Drag files or folders from Finder, a Linux file manager, or Windows Explorer onto any part of the DSH Web UI.

Release the mouse when the full-page drag hint appears; the plugin writes the resolved original absolute path into the current conversation input.

Dropping multiple items at once inserts one path per line.

## Path resolution

If the browser exposes a local file URI, the plugin converts it directly into the operating system’s native path.

If the browser hides the original path for security reasons, the plugin locates the file in this order:

1. The current Workspace
2. Other registered Workspaces
3. Desktop, Documents, and Downloads
4. The operating system’s file index
5. A bounded, platform-specific directory search

System indexes used per platform:

- macOS: Spotlight
- Linux: `plocate` first, then `locate`
- Windows: Everything CLI first, then PowerShell

On Linux, when the system index returns no candidates, the plugin also searches the user home directory and mount points under `/mnt` and `/media`.

On Windows, when the system index returns no candidates, the plugin also searches the user directory and available fixed disks.

To keep searches bounded:

- a single external index command times out after 3 seconds
- at most 100 candidate paths are kept
- each recursive search root visits at most 20,000 directory entries
- unreadable directories and files are ignored

## Candidate confirmation

Candidates are first filtered by:

- the full file name
- the file size

Modification time is used only for ranking candidates, never as identity.

If only one candidate remains, the plugin uses that path directly without reading the file’s content.

If multiple candidates remain, the plugin compares sampled fingerprints from the beginning, middle, and end of the files. Only when sampled fingerprints of large files still collide does it compute a full SHA-256.

If several paths correspond to byte-identical files, the plugin shows the list of paths and lets the user choose which one to insert.

Folders are first searched by name only. A unique candidate is returned directly without traversing the browser directory; multiple same-name candidates are compared by sorted relative path, project type, and file size. For directories that are structurally identical, content samples of up to 24 deterministically chosen files are computed; if still identical, the user picks the path. Directory traversal processes at most 10,000 entries and 32 levels deep, and never follows symlinks or Windows junctions.

Each search level first checks the direct children of the search root, then queries the OS index within that scope, and only then recurses into directories. The priority of the current Workspace, other Workspaces, and common directories is preserved.

## Privacy & file access

The plugin never:

- uploads files
- copies files
- moves files
- modifies files
- deletes files

In most cases the plugin only reads file metadata.

Only when multiple candidates share the same name and size does it read a small amount of content to compute sampled fingerprints, and only when large files cannot be told apart by sampling does it read the full content to compute SHA-256.

All resolution and fingerprinting happens locally on the machine running DSH.

## Platform notes

### macOS

Finder drag-and-drop and the Spotlight index are supported. Verified in Chrome on macOS.

### Linux

File managers that provide `text/uri-list` are supported. When the browser hides the path, the plugin searches Workspaces, common directories, `plocate`, `locate`, and bounded mount directories.

Installing `plocate` is recommended for faster global path resolution.

### Windows

Drive-letter paths and UNC network paths are supported. When the browser hides the path, the plugin prefers the Everything CLI; without Everything it uses PowerShell to search the user directory and fixed disks.

Installing Everything and its command-line tools significantly speeds up path resolution on large disks.

## Uninstall

```sh
dsh plugin --profile web remove @dsh-external/dsh-drag-and-drop
```

Then restart DSH Web UI the way you normally do.

## Development

The build script needs a DSH checkout. By default it locates one through the `dsh` command; you can also point it explicitly:

```sh
DSH_CHECKOUT=/path/to/dsh pnpm run build
```

Run tests:

```sh
pnpm test
```

Type-check:

```sh
pnpm run check
```

Build:

```sh
pnpm run build
```

## License

BSD-3-Clause
