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
