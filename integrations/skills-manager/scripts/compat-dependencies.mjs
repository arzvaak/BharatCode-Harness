// 0.1.7-rc.1, 0.1.7-rc.2, 0.2.0-rc.1, and 0.2.0-rc.2 all use Cordis ~4.0.4; earlier verified rc hosts remain pinned to 4.0.2.
// The latest official Cordis plugins accept only ~4.0.4. If these float on older hosts, the HMR service is not registered and the patch watcher exits.
const CORDIS_PINS = Object.freeze({
  "0.1.7-rc.1": "4.0.4",
  "0.1.7-rc.2": "4.0.4",
  "0.2.0-rc.1": "4.0.4",
  "0.2.0-rc.2": "4.0.4",
});
const CORDIS_PLUGIN_PINS = Object.freeze({
  "4.0.2": {
    "@deepseek-ai/cordis-plugin-group": "1.0.2",
    "@deepseek-ai/cordis-plugin-hmr": "1.0.17",
    "@deepseek-ai/cordis-plugin-include": "1.0.7",
    "@deepseek-ai/cordis-plugin-loader": "1.0.3",
    "@deepseek-ai/cordis-plugin-timer": "1.1.4",
  },
  "4.0.4": {
    "@deepseek-ai/cordis-plugin-group": "1.0.4",
    "@deepseek-ai/cordis-plugin-hmr": "1.0.19",
    "@deepseek-ai/cordis-plugin-include": "1.0.9",
    "@deepseek-ai/cordis-plugin-loader": "1.0.5",
    "@deepseek-ai/cordis-plugin-timer": "1.1.6",
  },
});

export function cordisPin(hostVersion) {
  return CORDIS_PINS[hostVersion] ?? "4.0.2";
}

export function hostCordisOverrides(hostVersion) {
  const cordis = cordisPin(hostVersion);
  return { "@deepseek-ai/cordis": cordis, ...CORDIS_PLUGIN_PINS[cordis] };
}

// pnpm package-name wildcard overrides are not guaranteed to match transitive dependencies, so pin official dependencies while resolving each package.
export function pinHostDependencies(manifest, version) {
  const pinned = { ...manifest };
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (!manifest[field]) continue;
    pinned[field] = Object.fromEntries(Object.entries(manifest[field]).map(([name, range]) =>
      [name, name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-") ? version : range]));
  }
  return pinned;
}
