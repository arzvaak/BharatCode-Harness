// Verify scope and filtering through real component events rather than implementation source string shapes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let definition, component, cursor = 0;
let state = [];
const outerState = [], effects = [];
let innerState = [], mountedKey, currentSession = "session-a";
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((child) => child != null && typeof child !== "boolean") }),
  useState(initial) { const index = cursor++, store = state; if (!(index in store)) store[index] = initial; return [store[index], (next) => { store[index] = typeof next === "function" ? next(store[index]) : next; }]; },
  useRef(value) { const index = cursor++; return state[index] || (state[index] = { current: value }); },
  useEffect(effect) { const index = cursor++; if (!(index in state)) { state[index] = true; effects.push(effect); } },
  // This test does not mount a DOM; focus restoration is covered by a dedicated unit test and a real browser.
  useLayoutEffect() { cursor++; },
  forwardRef(render) { return render; },
  createContext() { return { Provider() {}, Consumer() {} }; },
  useMemo(fn) { return fn(); },
  useCallback(fn) { return fn; },
  useContext() { return {}; },
  useId() { return "id"; },
  memo(component) { return component; },
  Fragment: Symbol.for("react.fragment"),
  version: "18.3.1",
  Children: { map(children, fn) { return [].concat(children ?? []).filter((child) => child != null).map(fn); }, forEach() {}, count: () => 0, toArray: (children) => [].concat(children ?? []), only: (child) => child },
  isValidElement: (value) => !!value && typeof value === "object",
  cloneElement: (element) => element,
  createRef: () => ({ current: null }),
  Component: class { constructor(props) { this.props = props; } },
  PureComponent: class { constructor(props) { this.props = props; } },
};
const skill = (name) => ({ name, description: "LONG_DESCRIPTION_" + name, enabled: true, loadable: true });
const data = {
  projects: [{ root: "/a", name: "A" }, { root: "/b", name: "B" }], trash: [],
  roots: [
    { key: "dsh", mutable: true, skills: [skill("global-one")] },
    { key: "copilot", exists: true, enabled: true, skills: [skill("global-two")] },
    { key: "a-dsh", scope: "project", kind: "project-dsh", projectRoot: "/a", localeKey: "projectDsh", mutable: true, skills: [] },
    { key: "a-copilot", scope: "project", kind: "project-copilot", projectRoot: "/a", localeKey: "copilot", exists: true, toggleable: true, skills: [skill("project-a")] },
    { key: "b-dsh", scope: "project", kind: "project-dsh", projectRoot: "/b", localeKey: "projectDsh", mutable: true, skills: [skill("project-b")] },
  ],
};
function sessionData(options) {
  const project = options?.headers?.["x-dsh-skills-session"] === "session-a" ? "/a" : options?.headers?.["x-dsh-skills-session"] === "session-b" ? "/b" : "";
  return { ...data, projects: data.projects.filter((p) => p.root === project), roots: data.roots.filter((root) => root.scope !== "project" || root.projectRoot === project) };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_, options) => ({ ok: true, json: async () => ({ data: sessionData(options) }) });
try {
  new Function("window", await readFile(new URL("../lib/client.js", import.meta.url), "utf8"))({ __ModuleLoader__: { load(value) { definition = value; } } });
  const client = definition.factory((id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: react.createElement, jsxs: react.createElement, Fragment: react.Fragment };
    if (id.startsWith("react-dom")) return { createPortal: (node) => node };
    throw new Error("unexpected require: " + id);
  });
  client.apply({ effect() {}, slots: { inject(name, fn) { fn(); }, register(options, fn) { component = fn; } } });
  const t = (key, params = {}) => (client.DICT.zh[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? "{" + name + "}"));
  let tree;
  let snapshotFor = (id) => ({ current: id });
  function render() {
    state = outerState; cursor = 0;
    const view = component({ t, useSessions: (selector) => selector(snapshotFor(currentSession)) });
    if (mountedKey !== view.props.key) { mountedKey = view.props.key; innerState = []; }
    state = innerState; cursor = 0; tree = view.type(view.props);
  }
  async function selectSession(id) {
    currentSession = id; render();
    assert.equal(nodes().some((node) => node.props.className === "dssm-source"), false, "Switching sessions immediately hides the old project while waiting for the new state");
    effects.splice(0).forEach((effect) => effect());
    await new Promise((resolve) => setImmediate(resolve)); render();
  }
  function linkedNodes(value, out = []) {
    if (value == null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return out;
    if (Array.isArray(value)) { value.forEach((item) => linkedNodes(item, out)); return out; }
    out.push(value);
    return out;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    // Filtering behavior tests only drive controlled values; official menu interactions are covered by dedicated tests and a real browser.
    if (typeof node.type === "function" && Array.isArray(node.props?.options) && node.props.label && node.props.onChange) return [{ type: "select-fixture", props: { "aria-label": node.props.label, options: node.props.options, onChange: (event) => node.props.onChange(event?.target ? event.target.value : event) }, children: [] }];
    if (node.type?.name === "SkillSwitch" || node.props?.closeLabel || (typeof node.type === "function" && node.props && "on" in node.props && typeof node.props.label === "string")) return nodes(node.type({ ...node.props, children: node.children }));
    const nested = linkedNodes(node.children);
    if (typeof node.type === "function") {
      linkedNodes(node.props?.header, nested);
      linkedNodes(node.props?.extra, nested);
      linkedNodes(node.props?.actions, nested);
      linkedNodes(node.props?.title, nested);
      linkedNodes(node.props?.description, nested);
      if (Array.isArray(node.props?.items)) node.props.items.forEach((item) => { linkedNodes(item?.label, nested); linkedNodes(item?.extra, nested); linkedNodes(item?.children, nested); });
    }
    return [node, ...nested.flatMap((child) => nodes(child))];
  }
  const find = (predicate) => nodes().find(predicate);
  const rows = () => nodes().filter((node) => node.props.className === "dssm-name").map((node) => node.children[0]);
  const change = (label, value) => { find((node) => node.props["aria-label"] === label).props.onChange({ target: { value } }); render(); };
  const tab = (name) => { const tabs = find((node) => node.props?.block === true && Array.isArray(node.props.options)); const option = tabs.props.options.find((item) => item.label === name || (Array.isArray(item.label) && item.label.includes(name))); tabs.props.onChange(option.value); render(); };
  render(); effects.splice(0).forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve)); render();
  const groups = () => nodes().filter((node) => node.props.className === "dssm-source" && Array.isArray(node.props.items));
  const expandAll = () => { groups().filter((node) => ![].concat(node.props.activeKey || []).includes(node.props.items[0].key)).forEach((node) => node.props.onChange([node.props.items[0].key])); render(); };
  assert.deepEqual(rows(), [], "Sources are collapsed by default rather than listing every skill flat");
  assert.equal(groups().length, 2, "Global skills are grouped by source");
  assert.ok(nodes(groups()[0]).some((node) => node.children.includes("1 skill")), "Source counts use translated copy");
  expandAll();
  assert.deepEqual(rows(), ["global-one", "global-two"]);
  const states = nodes().filter((node) => node.props.className === "dssm-row-state");
  assert.equal(states.length, 2, "Each skill has its own status action group");
  assert.ok(nodes(states[0]).some((node) => String(node.props["aria-label"] || "").includes(t("skill.toggle"))), "The switch and status are in the same group");
  const skillActions = nodes().filter((node) => node.props.className === "dssm-skill-actions");
  assert.equal(skillActions.length, 2, "Actions for each skill are grouped together");
  assert.ok(skillActions.every((node) => node.children.at(-1)?.props?.className === "dssm-row-state"), "The skill switch is at the far right of the row");
  assert.equal(nodes().some((node) => node.props.className === "dssm-status dssm-enabled"), false, "The switch indicates the enabled state without repeating it as text");
  const more = find((node) => node.props["aria-label"] === t("btn.more"));
  assert.ok(more.props.options.some((option) => option.value === "trash" && option.danger), "The More menu offers a trash action for writable skills");
  more.props.onChange({ target: { value: "trash" } }); render();
  assert.ok(find((node) => node.props.title === t("confirm.trash.title")), "The trash action still opens a confirmation dialog first");
  find((node) => node.children.includes(t("btn.cancel"))).props.onClick(); render();
  assert.ok(JSON.stringify(nodes()).includes("LONG_DESCRIPTION_global-one"), "Expanding a source displays the skill description");
  groups()[0].props.onChange([]); render();
  assert.deepEqual(rows(), ["global-two"], "Sources can be collapsed independently");
  change(t("search"), "two");
  assert.deepEqual(rows(), ["global-two"]);
  tab("Project skills");
  assert.equal(find((node) => node.props["aria-label"] === "Choose project"), undefined, "There is no project selector");
  assert.deepEqual(rows(), [], "Project sources are collapsed by default");
  assert.equal(groups().length, 2, "Empty writable project sources retain their group headers");
  expandAll();
  assert.deepEqual(rows(), ["project-a"]);
  change(t("filter.source"), "a-copilot");
  assert.ok(
    find((node) => String(node.props["aria-label"] || "").includes(t("source.toggle"))),
    "Selecting a read-only source on the Project tab displays a source toggle",
  );
  change(t("filter.source"), "a-dsh");
  assert.equal(
    find((node) => String(node.props["aria-label"] || "").includes(t("source.toggle"))),
    undefined,
    "Project DSH does not display a source-level toggle",
  );
  change(t("filter.source"), "");
  change(t("search"), "not-found");
  assert.deepEqual(rows(), []);
  await selectSession("session-b");
  assert.deepEqual(rows(), [], "Project expansion state is independent");
  expandAll();
  assert.deepEqual(rows(), ["project-b"], "Different projects keep independent filters");
  tab("Global skills");
  assert.deepEqual(rows(), ["global-two"], "Returning to Global retains the search");
  tab("Project skills");
  await selectSession("session-a");
  assert.deepEqual(rows(), [], "Returning to the same project retains the search");
  change(t("search"), "");
  const projectCopy = data.roots.find((r) => r.key === "a-copilot").skills[0];
  projectCopy.shadowedBy = { root: "a-dsh", name: "project-a" };
  render();
  const shadowedSwitch = find((node) => node.props["aria-label"] === t("skill.toggle") + " project-a");
  assert.equal(shadowedSwitch.props.disabled, false, "An overridden copy can still be independently enabled or disabled");
  let toggleRequest;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") toggleRequest = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ data: sessionData(options) }) };
  };
  shadowedSwitch.props.onChange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(toggleRequest.url.endsWith("/disable"));
  assert.deepEqual(toggleRequest.body, { root: "a-copilot", name: "project-a" }, "Only the selected source is disabled; the winning policy is unchanged");
  render();
  const operationFeedback = () => find((node) => node.props.className === "dssm-feedback" && node.children.includes(t("result.updated")));
  assert.ok(operationFeedback(), "The operation result appears on the page where it was initiated");
  tab("Repositories");
  assert.equal(operationFeedback(), undefined, "The Repositories page does not show results from other pages");
  tab("Trash");
  assert.equal(operationFeedback(), undefined, "The Trash page does not show results from the skills page");
  tab("Project skills");
  let completePendingToggle;
  const fetchBeforePending = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST" && url.endsWith("/disable")) await new Promise((resolve) => { completePendingToggle = resolve; });
    return fetchBeforePending(url, options);
  };
  find((node) => node.props["aria-label"] === t("skill.toggle") + " project-a").props.onChange();
  tab("Repositories");
  completePendingToggle(); await new Promise((resolve) => setImmediate(resolve)); render();
  assert.equal(operationFeedback(), undefined, "Completing an operation after switching tabs must not contaminate the repository notice");
  globalThis.fetch = fetchBeforePending;
  tab("Project skills");
  delete projectCopy.shadowedBy;
  projectCopy.enabled = false;
  projectCopy.fallbackTo = { root: "copilot", name: "project-a", scope: "user" };
  render();
  assert.ok(find((node) => node.props.className === "dssm-note dssm-fallback" && node.children.includes("Currently using the global Copilot copy.")), "The disabled project row shows the global fallback source");
  assert.equal(find((node) => node.props["aria-label"] === t("skill.toggle") + " project-a").props.checked, false, "The notice does not change the copy's disabled state");
  projectCopy.fallbackTo = { root: "a-dsh", name: "project-a", scope: "project" };
  render();
  assert.ok(find((node) => node.props.className === "dssm-note dssm-fallback" && String(node.children[0]).includes("Currently using the project")));
  delete projectCopy.fallbackTo;
  render();
  assert.equal(find((node) => node.props.className === "dssm-note dssm-fallback"), undefined, "No notice appears when there is no fallback source");
  projectCopy.enabled = true;
  render();
  assert.equal(find((node) => node.props?.block === true).props.options.length, 4, "Repositories, Trash, and both skill views are sibling tabs");
  data.trash.push(
    { id: "trash-a", name: "removed-a", deletedAt: "2026-09-12T00:00:00Z", root: { scope: "project", projectName: "A" } },
    { id: "trash-b", name: "removed-b", deletedAt: "2026-09-12T00:00:00Z", root: { scope: "user" } },
  );
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") {
      toggleRequest = { url, body: JSON.parse(options.body) };
      data.trash = data.trash.filter((item) => item.id !== toggleRequest.body.id);
    }
    return { ok: true, json: async () => ({ data: sessionData(options) }) };
  };
  render(); tab("Trash");
  assert.deepEqual(rows(), ["removed-a", "removed-b"], "Trash directly displays global and project entries");
  assert.equal(find((node) => node.props["aria-label"] === t("search")), undefined, "Trash does not display skill filters");
  assert.equal(find((node) => node.props.className === "dssm-summary"), undefined);
  assert.equal(find((node) => node.children.includes(t("btn.create"))), undefined);
  assert.equal(find((node) => node.props.role === "tabpanel").props["aria-labelledby"], "dssm-tab-trash");
  const trashTab = find((node) => node.props?.block === true).props.options.find((item) => item.value === "trash");
  assert.equal([].concat(trashTab.label).find((node) => node?.props?.className === "dssm-trash-count").children[0], 2);
  find((node) => node.children.includes(t("btn.restore"))).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  assert.ok(toggleRequest.url.endsWith("/trash-restore"));
  assert.deepEqual(toggleRequest.body, { id: "trash-a" });
  assert.deepEqual(rows(), ["removed-b"]);
  find((node) => node.children.includes(t("btn.delete.forever"))).props.onClick(); render();
  assert.ok(find((node) => node.props.title === t("confirm.delete.title")), "Permanent deletion still requires confirmation");
  find((node) => node.children.includes(t("btn.cancel"))).props.onClick(); render();
  assert.equal(find((node) => node.props.title === t("confirm.delete.title")), undefined, "Canceling leaves the user on the Trash tab");
  assert.deepEqual(rows(), ["removed-b"]);
  find((node) => node.children.includes(t("btn.delete.forever"))).props.onClick(); render();
  nodes().filter((node) => node.children.includes(t("btn.delete.forever"))).at(-1).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  assert.ok(toggleRequest.url.endsWith("/trash-delete"));
  assert.deepEqual(toggleRequest.body, { id: "trash-b" });
  assert.equal(find((node) => node.props.title === t("confirm.delete.title")), undefined);
  assert.ok(find((node) => node.props.className === "dssm-empty" && node.children.includes(t("trash.empty"))));
  assert.equal(find((node) => node.props.className === "dssm-trash-count"), undefined, "An empty Trash view does not display a count badge");
  tab("Global skills");
  assert.deepEqual(rows(), ["global-two"], "The global filter is retained after visiting Trash");
  tab("Project skills");
  assert.deepEqual(rows(), ["project-a"], "The selected project and filter are retained after visiting Trash");
  const create = find((node) => node.children.includes(t("btn.create")));
  assert.equal(create.props.disabled, false, "A global skill can still be created from the Project view");
  create.props.onClick(); render();
  assert.equal(find((node) => node.props["aria-label"] === t("create.target")), undefined, "The target location is not a dropdown");
  assert.ok(find((node) => node.props.className === "dssm-detail-path" && node.children.includes(t("create.globalTarget"))), "The target location is fixed to Global DSH");
  for (const [key, value] of [["name", "new-global"], ["description", "description"], ["body", "body"]]) {
    find((node) => node.props.placeholder === t("create." + key + ".placeholder")).props.onChange({ target: { value } }); render();
  }
  nodes().filter((node) => node.children.includes(t("btn.create.now"))).at(-1).props.onClick();
  await new Promise((resolve) => setImmediate(resolve)); render();
  assert.ok(toggleRequest.url.endsWith("/create"));
  assert.equal(toggleRequest.body.root, "dsh", "Creation from the Project view also submits only the Global DSH target");
  create.props.onClick(); render();
  await selectSession(undefined);
  assert.equal(find((node) => node.props.title === t("create.title")), undefined, "Switching sessions closes the old project's create form");
  assert.equal(groups().length, 0, "Without a current session, the view does not fall back to another project");
  assert.ok(find((node) => node.children.includes(t("project.empty"))), "An empty state appears when there is no current project");
  assert.equal(find((node) => node.children.includes(t("btn.create"))).props.disabled, false, "A global skill can still be created when there is no current project");
  let resolveOld;
  globalThis.fetch = async (_, options) => {
    const snapshot = { data: sessionData(options) };
    if (options?.headers?.["x-dsh-skills-session"] === "session-a") await new Promise((resolve) => { resolveOld = resolve; });
    return { ok: true, json: async () => snapshot };
  };
  await selectSession("session-a");
  await selectSession("session-b");
  assert.ok(rows().includes("project-b"));
  resolveOld(); await new Promise((resolve) => setImmediate(resolve)); render();
  assert.ok(rows().includes("project-b") && !rows().includes("project-a"), "A slow response from an old session does not replace the current session");
  console.log("Current-session binding, tabs, project isolation, filter persistence, and create-target interaction checks passed");

  snapshotFor = (id) => id
    ? { ids: [id], byId: { [id]: { retainedBy: { mainView: 1 } } } }
    : { ids: [], byId: {} };
  outerState.length = 0;
  innerState = [];
  mountedKey = undefined;
  currentSession = "session-a";
  globalThis.fetch = async (_, options) => ({ ok: true, json: async () => ({ data: sessionData(options) }) });
  render(); effects.splice(0).forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve)); render();
  tab("Project skills");
  expandAll();
  assert.deepEqual(rows(), ["project-a"], "alpha.2 retained-by-main-view sessions can open project skills");
  await selectSession("session-b");
  expandAll();
  assert.deepEqual(rows(), ["project-b"], "alpha.2 project skills follow the main-view session when it changes");
  await selectSession(undefined);
  assert.ok(find((node) => node.children.includes(t("project.empty"))), "alpha.2 the project view is empty without a main-view session");
  console.log("alpha.2 retainedBy.mainView session binding checks passed");
} finally { globalThis.fetch = originalFetch; }
