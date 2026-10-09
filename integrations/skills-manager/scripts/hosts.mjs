import assert from "node:assert/strict";
// Verified official host combinations; release metadata is checked by contract tests.
export const supportedHosts = Object.freeze(["0.1.2-rc.1", "0.1.5-rc.1", "0.1.5-rc.2", "0.1.5-rc.3", "0.1.7-rc.1", "0.1.7-rc.2", "0.2.0-rc.1", "0.2.0-rc.2"]);
export const peerRange = supportedHosts.join(" || ");
export const developmentHost = "0.2.0-rc.2";

export const requiredHostPeers = Object.freeze([
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-host-webserver",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-skill",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/dsh-web-app",
]);
export function assertHostPeers(peers) {
  assert.deepEqual(Object.keys(peers).filter(name => name.startsWith("@deepseek-ai/dsh-")).sort(), [...requiredHostPeers].sort(), "Official peer set does not match the required list");
}
