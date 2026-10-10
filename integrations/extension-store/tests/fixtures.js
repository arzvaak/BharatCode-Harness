import { gzipSync } from "node:zlib";
export function archive(manifest) {
  const data = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(512);
  header.write("package/package.json");
  header.write(data.length.toString(8).padStart(11, "0"), 124);
  header[156] = 48;
  header.fill(32, 148, 156);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(
    Buffer.concat([
      header,
      data,
      Buffer.alloc((512 - (data.length % 512)) % 512),
      Buffer.alloc(1024),
    ]),
  );
}

function tarEntry(name, data, { type = '0', mode = 0o644, link = '' } = {}) {
  const bytes = Buffer.from(data ?? '');
  const header = Buffer.alloc(512);
  const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0';
  header.write(name, 0, 100);
  header.write(octal(mode, 8), 100, 8);
  header.write(octal(0, 8), 108, 8);
  header.write(octal(0, 8), 116, 8);
  header.write(octal(bytes.length, 12), 124, 12);
  header.write(octal(0, 12), 136, 12);
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write(link, 157, 100);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  let checksum = 0;
  for (const value of header) checksum += value;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

export function managedArchive(entries = [{ path: 'runtime/bin/python3', data: '#!/bin/sh\necho Python 3.12.14\n', mode: 0o755 }]) {
  const contents = [tarEntry('runtime/', '', { type: '5', mode: 0o755 }), ...entries.map(entry =>
    tarEntry(entry.path, entry.data, { type: entry.type ?? '0', mode: entry.mode ?? 0o644, link: entry.link ?? '' })), Buffer.alloc(1024)];
  return gzipSync(Buffer.concat(contents));
}
