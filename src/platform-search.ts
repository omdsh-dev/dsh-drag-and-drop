import { execFile } from 'node:child_process'
import { access, constants, readdir } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 3000
export const PLATFORM_MAX_CANDIDATES = 100

export interface PlatformSearchHost {
  readonly platform: NodeJS.Platform
  readonly home: string
  commandExists(command: string): Promise<boolean>
  exec(command: string, args: readonly string[]): Promise<string>
  /** Raw (undecoded) stdout — es.exe and the PowerShell fallback emit the console's legacy code page (e.g. GBK), not UTF-8. */
  execBuffer(command: string, args: readonly string[]): Promise<Uint8Array>
  windowsDrives(): Promise<readonly string[]>
}

const host: PlatformSearchHost = {
  platform: platform(),
  home: homedir(),
  async commandExists(command) {
    if (command.includes('/') || command.includes('\\')) {
      try { await access(command, constants.X_OK); return true } catch { return false }
    }
    const probe = platform() === 'win32' ? 'where.exe' : '/usr/bin/env'
    const args = platform() === 'win32' ? [command] : ['sh', '-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command]
    try { await execFileAsync(probe, args, { timeout: 1000 }); return true } catch { return false }
  },
  async exec(command, args) {
    const { stdout } = await execFileAsync(command, [...args], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  },
  async execBuffer(command, args) {
    return new Promise<Uint8Array>((resolve, reject) => {
      execFile(command, [...args], {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        encoding: 'buffer',
      }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      })
    })
  },
  async windowsDrives() {
    try {
      const output = await this.exec('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '[System.IO.DriveInfo]::GetDrives() | Where-Object {$_.DriveType -eq "Fixed" -and $_.IsReady} | ForEach-Object {$_.RootDirectory.FullName}',
      ])
      return output.split(/\r?\n/).filter(Boolean)
    } catch {
      return []
    }
  },
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, PLATFORM_MAX_CANDIDATES)
}

async function macSearch(name: string, runtime: PlatformSearchHost): Promise<string[]> {
  const escaped = name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  try { return lines(await runtime.exec('/usr/bin/mdfind', [`kMDItemFSName == "${escaped}"c`])) } catch { return [] }
}

async function linuxSearch(name: string, runtime: PlatformSearchHost): Promise<string[]> {
  for (const command of ['plocate', 'locate']) {
    if (!await runtime.commandExists(command)) continue
    try {
      const paths = lines(await runtime.exec(command, ['--basename', '--limit', String(PLATFORM_MAX_CANDIDATES * 4), name]))
      return paths.filter(path => path.split('/').at(-1) === name).slice(0, PLATFORM_MAX_CANDIDATES)
    } catch {
      // Try the next system index.
    }
  }
  return []
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * es.exe and the PowerShell fallback print results using the console's active
 * code page — GBK on Chinese/Japanese Windows, UTF-8 on modern systems. UTF-8
 * decoding of GBK output mangles non-ASCII names (e.g. 新建.txt → �½�), which
 * breaks the exact basename match in validateCandidates. The search term is
 * known here, so decode both ways and keep the one that actually reproduces
 * the requested file name in the results; ties (pure-ASCII output) prefer UTF-8.
 */
export function decodeWindowsOutput(raw: Uint8Array, name: string): string {
  let best = ''
  let bestScore = -1
  for (const decoder of [new TextDecoder('utf-8'), new TextDecoder('gbk')]) {
    const text = decoder.decode(raw)
    const score = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => line.split(/[\\/]/).at(-1) === name)
      .length
    if (score > bestScore) {
      bestScore = score
      best = text
    }
  }
  return best
}

async function windowsSearch(name: string, runtime: PlatformSearchHost): Promise<string[]> {
  if (await runtime.commandExists('es.exe')) {
    try {
      const raw = await runtime.execBuffer('es.exe', ['-n', String(PLATFORM_MAX_CANDIDATES), '-w', name])
      return lines(decodeWindowsOutput(raw, name))
    } catch {
      // Fall through to PowerShell.
    }
  }
  if (!await runtime.commandExists('powershell.exe')) return []
  const roots = [runtime.home, ...await runtime.windowsDrives()]
  const script = [
    `$name=${powershellLiteral(name)}`,
    `$roots=@(${roots.map(powershellLiteral).join(',')}) | Select-Object -Unique`,
    `$roots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter $name -File -Recurse -Force -ErrorAction SilentlyContinue }`,
    `| Select-Object -First ${String(PLATFORM_MAX_CANDIDATES)} -ExpandProperty FullName`,
  ].join(' ')
  try {
    const raw = await runtime.execBuffer('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    return lines(decodeWindowsOutput(raw, name))
  } catch { return [] }
}

export async function indexedSearch(name: string, runtime: PlatformSearchHost = host): Promise<string[]> {
  if (runtime.platform === 'darwin') return macSearch(name, runtime)
  if (runtime.platform === 'linux') return linuxSearch(name, runtime)
  if (runtime.platform === 'win32') return windowsSearch(name, runtime)
  return []
}

export async function broadSearchRoots(runtime: PlatformSearchHost = host): Promise<string[]> {
  if (runtime.platform === 'linux') {
    const roots = [runtime.home]
    for (const parent of ['/mnt', '/media']) {
      try {
        for (const entry of await readdir(parent, { withFileTypes: true })) {
          if (entry.isDirectory()) roots.push(join(parent, entry.name))
        }
      } catch {
        // Optional mount parent absent or unreadable.
      }
    }
    return roots
  }
  if (runtime.platform === 'win32') return [runtime.home, ...await runtime.windowsDrives()]
  return []
}
