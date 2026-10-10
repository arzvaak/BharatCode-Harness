import { sign, createHash } from "node:crypto";
import { validateCatalog } from "../../integrations/extension-store/src/contracts.js";
export function signCatalog(bytes, key) {
  validateCatalog(JSON.parse(bytes.toString()));
  return {
    bytes,
    signature: sign(null, bytes, key).toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export function promoteCatalog(manifest) {
  if (
    !Number.isSafeInteger(manifest.revision) ||
    manifest.revision < 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.catalogSha256) ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.some(
      (a) => typeof a.name !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256),
    )
  )
    throw Error("Invalid promotion inventory");
  return {
    ...structuredClone(manifest),
    channel: "stable",
    sourceChannel: "preview",
  };
}
