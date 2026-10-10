import { gunzipSync } from "node:zlib";
/** Inspect the bounded archive before the native manager extracts it. No files are written. */
export function validateArchive(bytes, entry) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  let manifest;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((x) => x === 0)) break;
    const field = (start, end) =>
      header.subarray(start, end).toString().replace(/\0.*$/s, "").trim();
    const name = field(0, 100),
      prefix = field(345, 500);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeField = field(124, 136);
    if (!/^[0-7]+$/.test(sizeField)) throw Error("Invalid archive size");
    const size = parseInt(sizeField, 8);
    const check = field(148, 156);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (!/^[0-7]+$/.test(check) || parseInt(check, 8) !== sum)
      throw Error("Invalid archive checksum");
    if (
      !path.startsWith("package/") ||
      path.split("/").some((x) => x === ".." || x === ".") ||
      path.includes("\\") ||
      ![0, 48, 53].includes(header[156]) ||
      offset + 512 + size > tar.length
    )
      throw Error("Unsafe or incomplete package archive");
    if (path === "package/package.json") {
      if (manifest || size > 1024 * 1024)
        throw Error("Invalid package manifest");
      manifest = JSON.parse(
        tar.subarray(offset + 512, offset + 512 + size).toString(),
      );
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (
    !manifest ||
    manifest.name !== entry.packageName ||
    manifest.version !== entry.version
  )
    throw Error("Package identity differs from signed catalog");
  return manifest;
}
