window.__ModuleLoader__.load({id:"@arzvaak/dsh-provider-hub",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.jsx
var client_exports = {};
__export(client_exports, {
  ProviderHub: () => ProviderHub,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react2 = __toESM(require("react"), 1);

// src/controller.js
var RESERVED = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor", "codex", "copilot", "claude", "grok", "antigravity"]);
var PROTOCOLS = /* @__PURE__ */ new Set(["openai-completions", "openai-responses"]);
function unwrap(result) {
  if (!result?.ok) throw new Error(result?.error?.message || "The host could not complete this request.");
  return result.value;
}
function bharatCodeDraft() {
  return {
    route: "bharatcode",
    displayName: "BharatCode",
    baseURL: "https://bharatcode.ai/api/model/v1",
    api: "openai-completions",
    apiKeyEnv: "BHARATCODE_API_KEY",
    models: [{ id: "qwen-3.8-27b", name: "Qwen 3.8 27B", contextWindow: 262144, maxTokens: 32e3 }, { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", contextWindow: 1e6, maxTokens: 32e3 }]
  };
}
function customDraft() {
  return { route: "custom", displayName: "Custom provider", baseURL: "", api: "openai-completions", apiKeyEnv: "CUSTOM_API_KEY", models: [] };
}
function validateDraft(draft, { requireModels = true } = {}) {
  const route = String(draft.route || "").trim();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(route) || RESERVED.has(route)) throw new Error("Choose a unique route using lowercase letters, digits and hyphens. Subscription routes are reserved.");
  let url;
  try {
    url = new URL(draft.baseURL);
  } catch {
    throw new Error("Enter a complete API base URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use an HTTP or HTTPS base URL without credentials, query parameters or fragments.");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !loopback) throw new Error("Use HTTPS for remote providers. Localhost endpoints may use HTTP.");
  if (!PROTOCOLS.has(draft.api)) throw new Error("Select Chat Completions or Responses.");
  const apiKeyEnv = String(draft.apiKeyEnv || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error("Enter a valid credential reference such as BHARATCODE_API_KEY.");
  const models = draft.models || [];
  if (!Array.isArray(models) || models.length > 512 || requireModels && !models.length) throw new Error("Discover or enter at least one model (maximum 512).");
  const seen = /* @__PURE__ */ new Set();
  const normalized = models.map((model) => {
    const id = String(model.id || "").trim();
    if (!id || id.length > 256 || seen.has(id)) throw new Error("Each model needs a distinct, non-empty ID.");
    seen.add(id);
    const contextWindow = Number(model.contextWindow ?? 32768), maxTokens = Number(model.maxTokens ?? 4096);
    if (![contextWindow, maxTokens].every((n) => Number.isSafeInteger(n) && n > 0) || maxTokens > contextWindow) throw new Error("Model capacities must be positive integers, with output no larger than context.");
    return { ...model, id, name: model.name || id, contextWindow, maxTokens };
  });
  return { route, displayName: String(draft.displayName || route).trim(), baseURL: url.href.replace(/\/+$/, ""), api: draft.api, apiKeyEnv, models: normalized };
}
var ProviderController = class {
  constructor(remote) {
    this.remote = remote;
  }
  async load() {
    const [settings, directory, providers] = await Promise.all([
      this.remote.settings.describe().then(unwrap),
      this.remote.llm.listConfigurableProviders().then(unwrap),
      this.remote.llm.listProviders().then(unwrap)
    ]);
    const native = directory.find((row) => row.provider === "openai" && row.settingsPath?.[0] === "providers");
    this.section = native && settings.namespaces.find((row) => row.ns === native.settingsNs);
    if (!this.section) throw new Error("Enable the native @deepseek-ai/dsh-llm-pi-ai adapter in this profile, then reopen Providers.");
    this.directory = directory;
    this.writable = settings.writable;
    return { ns: this.section.ns, writable: settings.writable, providers, profiles: this.section.value?.providers || {} };
  }
  async discover(draft) {
    const profile = validateDraft(draft, { requireModels: false });
    if (!this.section) await this.load();
    const existing = this.section.value?.providers?.[profile.route];
    if (!draft.apiKey && existing && existing.baseURL !== profile.baseURL) throw new Error("Enter a key for the changed endpoint before discovery.");
    return unwrap(await this.remote.llm.discoverModels(this.section.ns, {
      baseURL: profile.baseURL,
      api: profile.api,
      ...existing && !draft.apiKey ? { provider: profile.route } : {},
      ...draft.apiKey ? { apiKey: draft.apiKey } : {}
    }));
  }
  async save(draft) {
    const { route, ...profile } = validateDraft(draft);
    if (!this.section) await this.load();
    if (!this.writable) throw new Error("This host has read-only settings.");
    const owner = this.directory.find((row) => row.provider === route);
    if (owner && owner.settingsNs !== this.section.ns) throw new Error("This route belongs to another adapter. Choose a different route.");
    const existing = this.section.value?.providers?.[route] || {};
    profile.models = profile.models.map((model) => ({ ...existing.models?.find((m) => m.id === model.id), ...model }));
    unwrap(await this.remote.settings.mutate(
      this.section.ns,
      [{ op: "set", path: ["providers", route], value: { ...existing, ...profile } }],
      this.section.revision
    ));
    if (draft.apiKey) {
      try {
        unwrap(await this.remote.credentials.set(profile.apiKeyEnv, draft.apiKey));
      } catch {
        throw new Error("The provider profile was saved, but its key could not be stored. Check credential permissions and save the key again.");
      }
    }
    return this.load();
  }
};
function providerDraft(id) {
  if (id === "bharatcode") return bharatCodeDraft();
  const preset = { mistral: ["Mistral", "https://api.mistral.ai/v1", "MISTRAL_API_KEY"], opencode: ["OpenCode", "https://opencode.ai/zen/v1", "OPENCODE_API_KEY"] }[id];
  return preset ? { ...customDraft(), route: id, displayName: preset[0], baseURL: preset[1], apiKeyEnv: preset[2] } : customDraft();
}

// src/style.js
var style_default = `
.ph-muse pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto}.ph-muse article{padding:12px;border-bottom:1px solid var(--dsw-alias-border-primary)}.ph-muse textarea{min-height:90px;font:inherit;}

.ph-root{color:var(--dsw-alias-text-primary,currentColor);font:inherit;max-width:780px;padding:4px 0 24px}
.ph-root h2{font-size:22px;margin:0 0 6px}.ph-root h3{font-size:17px;margin:0 0 8px}.ph-root h4{font-size:15px;margin:0}
.ph-root p{font-size:13px;line-height:1.6;margin:6px 0 14px;max-width:70ch}.ph-root>section{border-top:1px solid var(--dsw-alias-border-primary,#8885);padding:22px 0;margin-top:20px}
.ph-root fieldset{border:0;padding:0;margin:0;min-width:0}.ph-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ph-field{display:flex;flex-direction:column;gap:6px;font-size:13px;margin:12px 0;min-width:0}.ph-field input,.ph-field select{width:100%;box-sizing:border-box;background:var(--dsw-alias-background-primary,transparent);color:inherit;border:1px solid var(--dsw-alias-border-primary,#8887);border-radius:6px;padding:9px 10px;font:inherit}
.ph-root button{background:var(--dsw-alias-background-secondary,transparent);color:inherit;border:1px solid var(--dsw-alias-border-primary,#8886);border-radius:6px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}.ph-root button:hover{border-color:currentColor}.ph-root button:disabled,.ph-root fieldset:disabled{opacity:.55;cursor:default}
.ph-root input:focus-visible,.ph-root select:focus-visible,.ph-root button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5768d8);outline-offset:2px}
.ph-presets{display:flex;gap:8px;flex-wrap:wrap}.ph-model-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:22px}.ph-model{display:grid;grid-template-columns:2fr 1fr 1fr auto;align-items:end;gap:8px}.ph-model button{margin-bottom:12px}.ph-root .ph-help{font-size:12px;opacity:.75}.ph-root .ph-save{display:block;margin-top:20px;background:var(--dsw-alias-brand-primary,#4d5fc4);color:white;padding:10px 18px;border-color:transparent}.ph-subscription-body{padding-top:20px}.ph-note{padding:12px;border:1px solid var(--dsw-alias-border-primary,#8885);border-radius:6px;font-size:13px;line-height:1.6}.ph-error{color:var(--dsw-alias-text-error,#c33)}.ph-notice{border-left:3px solid var(--dsw-alias-brand-primary,#5768d8);padding-left:12px}
@media(max-width:600px){.ph-grid{grid-template-columns:1fr}.ph-model{grid-template-columns:1fr 1fr}.ph-model .ph-field:first-child{grid-column:1/-1}.ph-root h2{font-size:20px}.ph-model-heading{align-items:flex-start;flex-wrap:wrap}}
`;

// src/MusePanel.jsx
var import_react = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
async function call(action, data = {}) {
  const response = await fetch("/api/bc-muse", { credentials: "same-origin", ...action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...data }) } : {} });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || "Muse request failed");
  return value;
}
function Questions({ prompt, onAnswer, busy }) {
  const [answers, setAnswers] = (0, import_react.useState)({});
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: (event) => {
    event.preventDefault();
    onAnswer(prompt.userInputId, prompt.questions.map((question) => ({ questionId: question.id, ...answers[question.id] })));
  }, children: [
    prompt.questions.map((question) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { disabled: busy, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: question.question }),
      question.options?.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": question.header || question.question, multiple: question.selection?.mode === "multiple", value: answers[question.id]?.selectedLabels || answers[question.id]?.selectedLabel || "", onChange: (event) => setAnswers({ ...answers, [question.id]: question.selection?.mode === "multiple" ? { selectedLabels: [...event.target.selectedOptions].map((option) => option.value) } : { selectedLabel: event.target.value } }), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "Choose an answer" }),
        question.options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: option.label, children: option.label }, option.label))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "ph-field", children: [
        "Your answer",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { maxLength: 500, value: answers[question.id]?.freeText || "", onChange: (event) => setAnswers({ ...answers, [question.id]: { freeText: event.target.value } }) })
      ] })
    ] }, question.id)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || prompt.questions.some((question) => !answers[question.id]), type: "submit", children: "Send answers" })
  ] });
}
function MusePanel() {
  const [view, setView] = (0, import_react.useState)(null), [cwd, setCwd] = (0, import_react.useState)(""), [text, setText] = (0, import_react.useState)(""), [error, setError] = (0, import_react.useState)(""), [busy, setBusy] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    let active = true;
    const refresh = () => call().then((next) => {
      if (active) setView(next);
    }).catch((error2) => {
      if (active) setError(error2.message);
    });
    void refresh();
    const timer = setInterval(refresh, 1e3);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (action, data) => {
    setBusy(true);
    setError("");
    try {
      setView(await call(action, data));
      if (action === "send") setText("");
    } catch (error2) {
      setError(error2.message);
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "ph-muse", "aria-label": "Muse subscription", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Muse subscription" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Uses the installed Muse Code CLI and its own signed-in subscription. Sign in once, select a workspace, then connect. Muse keeps its tools and permission prompts." }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || view?.login?.running, onClick: () => run("login"), children: "Sign in with Muse" }),
    view?.login?.output && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: "ph-cli-output", children: view.login.output }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "ph-field", children: [
      "Workspace",
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { disabled: busy || view?.sessionId, value: cwd, onChange: (event) => setCwd(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "Select a workspace" }),
        view?.workspaces?.map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: workspace.path, children: workspace.title }, workspace.path))
      ] })
    ] }),
    !view?.sessionId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || !cwd, onClick: () => run("connect", { cwd }), children: "Connect Muse CLI" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => run("close"), children: "Disconnect" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: view?.status || "Loading\u2026" }),
    view?.items?.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.kind === "userMessage" ? "You" : item.kind === "agentMessage" ? "Muse" : item.toolName || item.kind }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: String(item.text || item.output || item.fallbackText || item.status || "") })
    ] }, item.itemId)),
    view?.approvals?.map((prompt) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { "aria-label": "Muse permission request", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: prompt.subject?.summary || prompt.toolName || "Muse requests permission" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: prompt.rawArgs }),
      prompt.availableChoices?.map((choice) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => run("decide", { approvalId: prompt.approvalId, choiceId: choice.choiceId }), children: choice.label }, choice.choiceId))
    ] }, prompt.approvalId)),
    view?.questions?.map((prompt) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Questions, { prompt, busy, onAnswer: (userInputId, answers) => run("answer", { userInputId, answers }) }, prompt.userInputId)),
    view?.sessionId && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { onSubmit: (event) => {
      event.preventDefault();
      void run("send", { text });
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "ph-field", children: [
        "Message Muse",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { maxLength: 32768, value: text, onChange: (event) => setText(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || !text.trim(), type: "submit", children: "Send" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || !view.turnId, type: "button", onClick: () => run("cancel"), children: "Stop" })
    ] }),
    (error || view?.error) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: error || view.error })
  ] });
}

// src/client.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var inject = ["slots", "remote", "remote.settings", "remote.credentials", "remote.llm"];
function apply(ctx) {
  const controller = new ProviderController(ctx.remote);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = style_default;
    style.dataset.plugin = "dsh-provider-hub";
    document.head.appendChild(style);
    return () => style.remove();
  });
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "provider-hub",
    order: 85,
    label: "Providers",
    inject: () => ({ controller, slots: ctx.slots })
  }, ProviderHub));
  ctx.slots.inject("settings.account.provider-setup", () => ctx.slots.register({
    name: "settings.account.provider-setup",
    inject: () => ({ controller, slots: ctx.slots })
  }, ProviderHub));
}
function SubscriptionPanel({ slots, initiallyExpanded = false }) {
  (0, import_react2.useSyncExternalStore)((callback) => slots.subscribe("settings.section", callback), () => slots.getVersion("settings.section"));
  const entry = slots.entries("settings.section").find((row) => row.options.id === "subscriptions");
  const [expanded, setExpanded] = (0, import_react2.useState)(initiallyExpanded);
  if (!entry) return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ph-note", children: [
    "Install ",
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: "@arzvaak/bharatcode-subscriptions" }),
    " in this profile to enable ChatGPT (Codex), GitHub Copilot, Claude, Grok and Antigravity sign-in. Restart DSH after installation."
  ] });
  const Component = entry.component;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ph-subscriptions", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "ph-secondary", "aria-expanded": expanded, onClick: () => setExpanded(!expanded), children: expanded ? "Hide subscription sign-in" : "Manage subscription sign-in" }),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ph-subscription-body", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Component, { ...entry.inject?.() }) })
  ] });
}
function ProviderHub({ controller, slots }) {
  const [view, setView] = (0, import_react2.useState)(null), [draft, setDraft] = (0, import_react2.useState)(bharatCodeDraft), [key, setKey] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false), [error, setError] = (0, import_react2.useState)(""), [notice, setNotice] = (0, import_react2.useState)(""), [selected, setSelected] = (0, import_react2.useState)("bharatcode");
  (0, import_react2.useEffect)(() => {
    let active = true;
    controller.load().then((v) => {
      if (active) {
        setView(v);
        if (v.profiles.bharatcode) setDraft({ ...bharatCodeDraft(), ...v.profiles.bharatcode, route: "bharatcode" });
      }
    }).catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [controller]);
  const change = (field, value) => setDraft((old) => ({ ...old, [field]: value }));
  const updateModel = (index, field, value) => setDraft((old) => ({ ...old, models: old.models.map((model, i) => i === index ? { ...model, [field]: value } : model) }));
  const run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (selected2) => {
    setSelected(selected2);
    setKey("");
    setNotice("");
    setError("");
    if (["muse", "codex", "google"].includes(selected2)) return;
    const preset = providerDraft(selected2);
    const existing = view?.profiles?.[selected2];
    setDraft(existing ? { ...preset, ...existing, route: selected2, models: existing.models || preset.models } : preset);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "ph-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: "Providers" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "Use your BharatCode subscription, connect another subscription, or add an API key." })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-labelledby": "ph-sub-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { id: "ph-sub-title", children: "Subscriptions" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "ChatGPT uses your Codex subscription. Google uses the Antigravity sign-in flow. GitHub uses GitHub Copilot. Sign in with the installed subscription plugin." }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SubscriptionPanel, { slots })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { "aria-labelledby": "ph-endpoint-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { id: "ph-endpoint-title", children: "Model endpoints" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ph-presets", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: busy, type: "button", onClick: () => choose("codex"), children: "Codex subscription" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: busy, type: "button", onClick: () => choose("google"), children: "Google subscription" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: busy, type: "button", onClick: () => choose("bharatcode"), children: "BharatCode" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: busy, type: "button", onClick: () => choose("opencode"), children: "OpenCode" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: busy, type: "button", onClick: () => choose("mistral"), children: "Mistral API key" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: busy, type: "button", onClick: () => choose("muse"), children: "Muse subscription (CLI)" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { disabled: busy, type: "button", onClick: () => choose("custom"), children: "Other provider" })
      ] }),
      selected === "muse" && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MusePanel, {}),
      ["codex", "google"].includes(selected) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SubscriptionPanel, { slots, initiallyExpanded: true }),
      !["muse", "codex", "google"].includes(selected) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        view && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
          "Edit configured endpoint",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { disabled: busy, value: "", onChange: (e) => choose(e.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "Select a provider\u2026" }),
            Object.entries(view.profiles).filter(([, p]) => ["openai-completions", "openai-responses"].includes(p.api)).map(([route, p]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: route, children: p.displayName || route }, route))
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("form", { onSubmit: (e) => {
          e.preventDefault();
          run(async () => {
            const next = await controller.save({ ...draft, apiKey: key });
            setView(next);
            setKey("");
            setNotice("Provider saved. Open the model picker to select one of its models.");
          });
        }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { disabled: busy || !view || !view.writable, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ph-grid", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
              "Provider name",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: draft.displayName, onChange: (e) => change("displayName", e.target.value), required: true })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
              "Route ID",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: draft.route, onChange: (e) => change("route", e.target.value), required: true, placeholder: "my-provider" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
            "API base URL",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "url", value: draft.baseURL, onChange: (e) => change("baseURL", e.target.value), required: true, placeholder: "https://your-provider.example/v1" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
            "API format",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { value: draft.api, onChange: (e) => change("api", e.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "openai-completions", children: "Chat Completions" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "openai-responses", children: "Responses" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ph-grid", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
              "Key reference",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: draft.apiKeyEnv, onChange: (e) => change("apiKeyEnv", e.target.value), required: true })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
              "API key",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "password", autoComplete: "new-password", value: key, onChange: (e) => setKey(e.target.value), placeholder: "Leave blank to keep the stored key" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ph-help", children: "Keys are stored by DSH. You can also export the named key reference before launching DSH. For a local server that accepts any key, enter a placeholder key." }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ph-model-heading", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { children: "Models" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: () => run(async () => {
              const found = await controller.discover({ ...draft, apiKey: key });
              if (!found.length) throw new Error("The endpoint returned no models. Enter a model ID manually.");
              change("models", found.map((m) => ({ ...draft.models.find((old) => old.id === m.id), id: m.id, name: m.name || m.id, contextWindow: m.contextWindow || 32768, maxTokens: m.maxTokens || 4096, ...m.inputModalities ? { input: m.inputModalities } : {} })));
              setNotice("Model list discovered. Review capacities and remove any models you do not want before saving. Missing capacities use 32,768 context and 4,096 output as editable estimates.");
            }), children: "Discover models" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "ph-models", children: draft.models.map((model, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "ph-model", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
              "Model ID",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { value: model.id, onChange: (e) => updateModel(index, "id", e.target.value), required: true })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
              "Context tokens",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "number", min: "1", value: model.contextWindow ?? 32768, onChange: (e) => updateModel(index, "contextWindow", Number(e.target.value)), required: true })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "ph-field", children: [
              "Max output tokens",
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "number", min: "1", value: model.maxTokens ?? 4096, onChange: (e) => updateModel(index, "maxTokens", Number(e.target.value)), required: true })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", "aria-label": `Remove model ${model.id || index + 1}`, onClick: () => change("models", draft.models.filter((_, i) => i !== index)), children: "Remove" })
          ] }, index)) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "ph-secondary", onClick: () => change("models", [...draft.models, { id: "", contextWindow: 32768, maxTokens: 4096 }]), children: "Add model manually" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ph-help", children: "The BharatCode preset includes Qwen and DeepSeek. Discover models to check the current account catalog. Catalog visibility does not guarantee successful inference." }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "ph-save", type: "submit", children: busy ? "Working\u2026" : "Save provider" })
        ] }) })
      ] })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ph-error", role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "ph-notice", role: "status", children: notice }),
    view && !view.writable && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: "This host has read-only settings." })
  ] });
}
return module.exports;}});
