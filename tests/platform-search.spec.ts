import { describe, expect, it, vi } from 'vitest'
import { decodeWindowsOutput, indexedSearch, type PlatformSearchHost } from '../src/platform-search.ts'

function runtime(input: Partial<PlatformSearchHost> & Pick<PlatformSearchHost, 'platform'>): PlatformSearchHost {
  return {
    platform: input.platform,
    home: input.home ?? '/home/test',
    commandExists: input.commandExists ?? (async () => false),
    exec: input.exec ?? (async () => ''),
    execBuffer: input.execBuffer ?? (async () => new Uint8Array()),
    windowsDrives: input.windowsDrives ?? (async () => []),
  }
}

describe('indexedSearch', () => {
  it('uses Spotlight metadata queries on macOS', async () => {
    const exec = vi.fn(async () => '/home/test/a.txt\n')
    await expect(indexedSearch('a.txt', runtime({ platform: 'darwin', exec }))).resolves.toEqual(['/home/test/a.txt'])
    expect(exec).toHaveBeenCalledWith('/usr/bin/mdfind', ['kMDItemFSName == "a.txt"c'])
  })

  it('prefers plocate and filters basename matches on Linux', async () => {
    const exec = vi.fn(async () => '/home/test/a.txt\n/home/test/a.txt.bak\n')
    const commandExists = vi.fn(async command => command === 'plocate')
    await expect(indexedSearch('a.txt', runtime({ platform: 'linux', exec, commandExists })))
      .resolves.toEqual(['/home/test/a.txt'])
    expect(exec).toHaveBeenCalledWith('plocate', ['--basename', '--limit', '400', 'a.txt'])
  })

  it('uses Everything CLI on Windows when available', async () => {
    const execBuffer = vi.fn(async () => new TextEncoder().encode('C:\\work\\a.txt\r\n'))
    const commandExists = vi.fn(async command => command === 'es.exe')
    await expect(indexedSearch('a.txt', runtime({ platform: 'win32', home: 'C:\\Users\\test', execBuffer, commandExists })))
      .resolves.toEqual(['C:\\work\\a.txt'])
    expect(execBuffer).toHaveBeenCalledWith('es.exe', ['-n', '100', '-w', 'a.txt'])
    // The GUI binary is never probed: it cannot return results to stdout.
    expect(commandExists).not.toHaveBeenCalledWith('Everything.exe')
  })

  it('decodes GBK es.exe output for non-ASCII file names', async () => {
    // es.exe on Chinese Windows prints the console code page (GBK), not UTF-8.
    // 'C:\work\新建文本文档 (3).txt\r\n' encoded as GBK:
    const gbkBytes = Buffer.from('433a5c776f726b5cd0c2bda820cec4b1becec4b5b5202833292e7478740d0a', 'hex')
    const name = '新建 文本文档 (3).txt'
    const execBuffer = vi.fn(async () => gbkBytes)
    const commandExists = vi.fn(async command => command === 'es.exe')
    await expect(indexedSearch(name, runtime({ platform: 'win32', home: 'C:\\Users\\test', execBuffer, commandExists })))
      .resolves.toEqual(['C:\\work\\' + name])
    expect(execBuffer).toHaveBeenCalledWith('es.exe', ['-n', '100', '-w', name])
  })

  it('falls back to PowerShell on Windows', async () => {
    const execBuffer = vi.fn(async () => new TextEncoder().encode('D:\\repo\\a.txt\r\n'))
    const commandExists = vi.fn(async command => command === 'powershell.exe')
    await expect(indexedSearch('a.txt', runtime({
      platform: 'win32', home: 'C:\\Users\\test', execBuffer, commandExists,
      windowsDrives: async () => ['C:\\', 'D:\\'],
    }))).resolves.toEqual(['D:\\repo\\a.txt'])
    expect(execBuffer).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']))
  })
})

describe('decodeWindowsOutput', () => {
  it('picks the decoding that reproduces the searched file name', () => {
    const name = '新建 文本文档 (3).txt'
    const gbkBytes = Buffer.from('433a5c776f726b5cd0c2bda820cec4b1becec4b5b5202833292e7478740d0a', 'hex')
    expect(decodeWindowsOutput(gbkBytes, name)).toBe('C:\\work\\' + name + '\r\n')
  })

  it('keeps UTF-8 decoding for ASCII output', () => {
    expect(decodeWindowsOutput(new TextEncoder().encode('C:\\work\\a.txt\r\n'), 'a.txt')).toBe('C:\\work\\a.txt\r\n')
  })
})
