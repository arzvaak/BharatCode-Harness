// Filter dropdowns and action menus use Ant Design rather than custom triggers.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleSourceMenuEscape } from "../src/source-select-model.ts";

const selectSource = await readFile(new URL("../src/source-select.ts", import.meta.url), "utf8");
assert.ok(selectSource.includes("popupMatchSelectWidth: false"), "filter dropdown expands to fit its content instead of matching the trigger width");
assert.ok(selectSource.includes("danger: option.danger"), "action menu preserves the danger marker");
assert.ok(selectSource.includes("handleSourceMenuEscape"), "open filter or action menus delegate Escape to a dedicated handler");
assert.ok(!selectSource.includes("dsh-client-ui-primitives"), "dropdown no longer uses the host menu");

const escapeCalls = [];
assert.equal(handleSourceMenuEscape({
  key: "Escape",
  preventDefault: () => escapeCalls.push("prevent"),
  stopPropagation: () => escapeCalls.push("stop"),
  stopImmediatePropagation: () => escapeCalls.push("stopImmediate"),
}, () => escapeCalls.push("close")), true, "Escape closes the open menu");
assert.deepEqual(escapeCalls, ["prevent", "stop", "stopImmediate", "close"], "menu Escape no longer reaches the host settings page");
assert.equal(handleSourceMenuEscape({
  key: "Tab",
  preventDefault: () => escapeCalls.push("prevent"),
  stopPropagation: () => escapeCalls.push("stop"),
  stopImmediatePropagation: () => escapeCalls.push("stopImmediate"),
}, () => escapeCalls.push("close")), false, "other keys do not close the menu");

const source = await readFile(new URL("../src/client.ts", import.meta.url), "utf8");
assert.ok(source.includes('className: "dssm-search"'), "search field uses the Ant Design input");
assert.ok(!source.includes('h("input", { className: "dssm-control'), "visible text inputs must not use custom controls");
assert.ok(!source.includes("dssm-fallback-switch"), "switch no longer retains a custom fallback");
assert.ok(!source.includes("dssm-host-modal"), "modal is no longer wrapped in a custom shell");
assert.ok(source.includes('className: "dssm-row-state"'), "status and switch must be grouped together");
assert.ok(!source.includes("dsh-client-ui-primitives"), "settings page no longer depends on host UI components");
const updater = await readFile(new URL("../src/plugin-update-ui.ts", import.meta.url), "utf8");
assert.ok(updater.includes("handlePluginUpdateEscape"), "update modal still intercepts Escape");
console.log("Ant Design filters and leftover styles checked");
