// Verify filtering, collapsing, adding, and installation through real events.
import assert from "node:assert/strict";
import { createRepositoryUI } from "../src/repository-ui.ts";
let values = [], cursor = 0, effects = [], dependencies = [];
const react = {
  createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity).filter((v) => v != null && typeof v !== "boolean") }; },
  useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], (v) => { values[i] = typeof v === "function" ? v(values[i]) : v; }]; },
  useRef(initial) { const i = cursor++; return values[i] || (values[i] = { current: initial }); },
  useEffect(fn, deps) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => dependencies[i][n] !== v)) { effects.push(fn); dependencies[i] = deps; } },
};
let repos = [{ id: "one", owner: "example", name: "skills", skills: [{ path: "skills/pdf", name: "pdf", description: "PDF document", status: "available" }, { path: "skills/docx", name: "docx", description: "Word document", status: "conflict" }] }];
const calls = [];
let finishInstall;
let failInstall = false;
let finishRefresh, finishDetail;
let holdRefresh = false;
let failRefresh = false;
const api = async (path, options) => {
  const body = options?.body ? JSON.parse(options.body) : undefined;
  calls.push({ path, body });
  if (path.endsWith("/install")) {
    await new Promise((resolve) => { finishInstall = resolve; });
    if (failInstall) throw new Error("Download timed out; please retry");
    repos[0].skills[0].status = "installed";
  }
  if (path.endsWith("/add")) return { id: "two" };
  if (path.endsWith("/refresh")) { if (holdRefresh) await new Promise(resolve => { finishRefresh = resolve; }); if (failRefresh) throw new Error("Repository network request failed"); return { error: null }; }
  if (path.endsWith("/detail")) { await new Promise(resolve => { finishDetail = resolve; }); return { name: "pdf", body: "Description", commit: "abc", path: "skills/pdf" }; }
  if (path.endsWith("/preview")) return { token: "checked", commit: "a".repeat(40), localModified: true, changes: [{ kind: "modified", path: "SKILL.md" }] };
  if (path.endsWith("/update")) repos[0].skills[0].status = "installed";
  return { repositories: repos };
};
const Input = Symbol("official input");
const Button = Symbol("official button");
const isAction = (node, key) => (node.type === "button" || node.type === Button) && node.children.includes(key);
const useUI = createRepositoryUI({ react, Modal: "modal", Input, Button, api, headers: {}, translateError: (_t, e) => e.error || e.message });
let languagePrefix = "";
const t = (key) => languagePrefix + key;
let ui;
function render() { cursor = 0; ui = useUI({ active: true, t }); }
function nodes(node) { return !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap(nodes)]; }
const all = () => [...nodes(ui.actions), ...nodes(ui.content)];
const find = (predicate) => all().find(predicate);
const click = async (key) => { find((n) => isAction(n, key)).props.onClick(); await new Promise(setImmediate); render(); };
render(); effects.splice(0).forEach((f) => f()); await new Promise(setImmediate); render();
assert.equal(calls.filter(call => call.path === "/repositories").length, 1, "entering the repository view reads the list once");
assert.equal(find(n => isAction(n, "repo.check")), undefined, "no duplicate check-for-updates button is provided");
assert.equal(find((n) => n.props["aria-label"] === "repo.search").type, Input, "repository search must use the official input");
assert.equal(find((n) => n.props.className === "dssm-repo-row"), undefined, "collapsed by default");
find((n) => n.props["aria-expanded"] === false).props.onClick(); render();
assert.equal(all().filter((n) => n.props.className === "dssm-repo-row").length, 2);
assert.ok(find((n) => isAction(n, "repo.conflict")).props.disabled);
find((n) => n.props["aria-label"] === "repo.search").props.onChange({ target: { value: "PDF" } }); render();
assert.equal(all().filter((n) => n.props.className === "dssm-repo-row").length, 1);
const listCalls = calls.filter(call => call.path === "/repositories").length;
await click("repo.detail");
assert.ok(find(n => n.type === "modal"), "details open a loading modal immediately");
assert.equal(ui.content.props["aria-busy"], false, "loading details does not mark the background list as busy");
finishDetail(); await new Promise(setImmediate); render();
assert.equal(calls.filter(call => call.path === "/repositories").length, listCalls, "read-only details do not refresh the background list");
find(n => n.type === "modal").props.onClose(); render();
holdRefresh = true;
await click("repo.refresh");
assert.ok(find(n => n.props.className === "dssm-repo-spinner"), "an animated icon appears during refresh");
assert.ok(find(n => n.props.role === "status" && n.children.some(c => typeof c === "string" && c.includes("example/skills"))), "refresh shows the current repository");
finishRefresh(); await new Promise(setImmediate); render(); holdRefresh = false;
assert.equal(find(n => n.props.className === "dssm-repo-spinner"), undefined, "animation stops after completion");
await click("repo.manage");
holdRefresh = true; failRefresh = true;
const manageRefresh = nodes(find(n => n.type === "modal")).find(n => isAction(n, "repo.refresh"));
manageRefresh.props.onClick(); await new Promise(setImmediate); render();
assert.ok(nodes(find(n => n.type === "modal")).some(n => n.props.className === "dssm-repo-spinner"), "the current repository also shows animation in the management modal");
finishRefresh(); await new Promise(setImmediate); render(); holdRefresh = false; failRefresh = false;
assert.equal(find(n => n.props.className === "dssm-repo-spinner"), undefined, "animation stops after failure");
assert.ok(find(n => n.children.includes("Repository network request failed")), "failure message is retained");
find(n => n.type === "modal").props.onClose(); render();
await click("repo.install");
assert.ok(find((n) => isAction(n, "repo.installing"))?.props.disabled, "current row immediately shows installation in progress and disables the action");
assert.ok(find((n) => n.props.className === "dssm-repo-main")?.children.some((n) => n.props?.role === "status"), "installation progress should appear in the current row");
finishInstall(); await new Promise(setImmediate); render();
assert.deepEqual(calls.find((c) => c.path.endsWith("/install")).body, { id: "one", path: "skills/pdf" });
assert.ok(find((n) => isAction(n, "repo.installed")).props.disabled);
assert.ok(find((n) => n.props.className === "dssm-repo-main")?.children.some((n) => n.props?.role === "status" && n.children.join("").includes("repo.installSuccess")), "success result should remain in the current row");
languagePrefix = "en:"; render();
assert.ok(find(n => n.props.role === "status" && n.children.includes("en:repo.installSuccess")), "completed status is retranslated after switching languages");
languagePrefix = ""; render();
repos[0].skills[0].status = "available"; failInstall = true; render();
await click("repo.install"); finishInstall(); await new Promise(setImmediate); render();
assert.ok(find((n) => n.props.role === "alert" && n.children.includes("Download timed out; please retry")), "failure should be clearly reported in the current row");
assert.equal(find((n) => isAction(n, "repo.install")).props.disabled, false, "retry is available after failure");
await click("repo.add");
find((n) => n.props["aria-label"] === "repo.url").props.onChange({ target: { value: "a/b" } }); render();
await click("repo.save");
assert.ok(calls.some((c) => c.path.endsWith("/add") && c.body.url === "a/b"));
assert.ok(calls.some((c) => c.path.endsWith("/refresh") && c.body.id === "two"));
repos[0].skills[0] = { ...repos[0].skills[0], status: "update", tracked: true, updateAvailable: true, canRollback: true };
render();
await click("repo.review");
assert.ok(find(n => n.props.role === "alert" && n.children.includes("repo.modified")), "preview must warn about local modifications");
assert.ok(!calls.some(c => c.path.endsWith("/update")), "opening a preview does not perform an update");
await click("repo.overwrite");
assert.deepEqual(calls.find(c => c.path.endsWith("/update")).body, { id: "one", path: "skills/pdf", token: "checked", overwrite: true });
assert.ok(find(n => n.props.role === "status" && n.children.includes("repo.updateSuccess")), "completion status appears after an update");
await click("repo.rollback");
assert.equal(calls.filter(c => c.path.endsWith("/preview")).at(-1).body.rollback, true);
console.log("Repository UI collapse, search, conflict protection, installation, and add checks passed");
