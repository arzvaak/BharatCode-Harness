/**
 * Minimal UStar archive writer and extractor (POSIX.1-1988) for database files and _meta.json.
 * Names up to 99 bytes and files up to 8 GiB cover expected backups; oversized entries throw.
 * No third-party archive dependency; directly executable by the test suite.
 * @module @kenz1117/dsh-engram/backup/tar-stream
 */

import { join } from 'node:path'
import type { Writable } from 'node:stream'

/** UStar header field sizes (POSIX.1-1988). */
const BLOCK_SIZE = 512
const NAME_LEN = 100
const SIZE_LEN = 12

/** Write a number as fixed-width octal ASCII with a trailing null byte. */
function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  const str = value.toString(8).padStart(length - 1, '0')
  buf.write(str, offset, length - 1, 'ascii')
  buf.write('\0', offset + length - 1, 1, 'ascii')
}

/** Sum all 512 header bytes, treating the checksum field as spaces. */
function computeChecksum(header: Buffer): number {
  let sum = 0
  for (let i = 0; i < BLOCK_SIZE; i += 1) sum += header[i]!
  return sum
}

/** Write an entry: UStar header, contents, and padding to a 512-byte boundary. */
export function createTarPack(out: Writable, name: string, data: Buffer): void {
  if (name.length >= NAME_LEN) throw new Error(`tar filename too long (${String(name.length)} / ${String(NAME_LEN - 1)}): ${name}`)
  if (data.length >= 2 ** (8 * (SIZE_LEN - 1)) - 1) throw new Error(`tar file too large: ${name} (${String(data.length)} bytes)`)
  const header = Buffer.alloc(BLOCK_SIZE)
  header.write(name, 0, NAME_LEN, 'ascii')
  // mode: 0o600
  writeOctal(header, 100, 8, 0o600)
  // uid / gid: 0
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  // size
  writeOctal(header, 124, SIZE_LEN, data.length)
  // mtime: current time
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000))
  // typeflag: '0' = regular file
  header.write('0', 156, 1, 'ascii')
  // magic: 'ustar\0'
  header.write('ustar\0', 257, 6, 'ascii')
  // version: '00'
  header.write('00', 263, 2, 'ascii')
  // Magic and version occupy eight bytes; checksum occupies offsets 148 through 155.
  // Fill the checksum field with eight spaces before computing and writing its value.
  header.write('        ', 148, 8, 'ascii')
  const sum = computeChecksum(header)
  writeOctal(header, 148, 8, sum)
  out.write(header)
  out.write(data)
  // Pad to a 512-byte boundary.
  const padLen = (BLOCK_SIZE - (data.length % BLOCK_SIZE)) % BLOCK_SIZE
  if (padLen > 0) out.write(Buffer.alloc(padLen))
}

/** Write two zero-filled blocks to mark the end of the archive. */
export function endTarPack(out: Writable): void {
  out.write(Buffer.alloc(BLOCK_SIZE * 2))
}

/** Extract buffered archive bytes into the destination directory; suitable for small backups. */
export async function extractTar(buffer: Buffer, destDir: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  let offset = 0
  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE)
    if (header.every(b => b === 0)) return
    const name = header.toString('ascii', 0, NAME_LEN).replace(/\0+$/, '')
    // Engram backups contain flat regular files only. Reject path, link, and
    // prefix metadata before deriving any filesystem target.
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..'
      || header.subarray(345, 500).some(b => b !== 0)
      || (header[156] !== 0 && header[156] !== 48)) {
      throw new Error(`Unsafe backup archive entry: ${name}`)
    }
    const sizeOct = header.toString('ascii', 124, 124 + SIZE_LEN).replace(/\0+$/, '').trim()
    if (!/^[0-7]+$/.test(sizeOct)) throw new Error(`Invalid tar size: ${name}`)
    const size = parseInt(sizeOct, 8)
    const checksumOct = header.toString('ascii', 148, 156).replace(/\0/g, '').trim()
    const checksumHeader = Buffer.from(header)
    checksumHeader.fill(32, 148, 156)
    if (!/^[0-7]+$/.test(checksumOct) || parseInt(checksumOct, 8) !== computeChecksum(checksumHeader)) {
      throw new Error(`Invalid tar checksum: ${name}`)
    }
    offset += BLOCK_SIZE
    const padded = size + (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE
    if (!Number.isSafeInteger(size) || offset + padded > buffer.length) {
      throw new Error(`Truncated tar entry: ${name}`)
    }
    // Exclusive creation also rejects duplicates and pre-existing symlinks.
    await writeFile(join(destDir, name), buffer.subarray(offset, offset + size), { mode: 0o600, flag: 'wx' })
    offset += padded
  }
  throw new Error('Truncated tar archive: missing end marker')
}
