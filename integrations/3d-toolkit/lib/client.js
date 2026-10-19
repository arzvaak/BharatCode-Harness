window.__ModuleLoader__.load({id:"@bharatcode/3d-toolkit",factory(require){const module={exports:{}};const exports=module.exports;
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
  StudioPage: () => StudioPage,
  apply: () => apply,
  initialWorkspace: () => initialWorkspace,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "layout"];
async function request(action) {
  const response = await fetch("/api/bc-3d", { method: action ? "POST" : "GET", credentials: "same-origin", headers: action ? { "Content-Type": "application/json" } : {}, ...action ? { body: JSON.stringify(action) } : {} });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? "3D Studio is unavailable");
  return value;
}
function initialWorkspace(workspaces, context) {
  const sessions = context?.get?.("sessions")?.list?.getSnapshot?.();
  const current = Object.values(sessions?.byId ?? {}).find((item) => (item.retainedBy?.mainView ?? 0) > 0)?.id;
  const hosts = context?.get?.("workspaces")?.list?.getSnapshot?.().items ?? [];
  const active = hosts.find((item) => item.sessionIds?.includes(current));
  const id = active?.workspaceId ?? active?.id;
  return workspaces.find((item) => item.id === id)?.id ?? workspaces[0]?.id ?? "";
}
function StudioPage({ context } = {}) {
  const [state, setState] = (0, import_react.useState)({ projects: [], workspaces: [] }), [workspace, setWorkspace] = (0, import_react.useState)(""), [engine, setEngine] = (0, import_react.useState)("three"), [title, setTitle] = (0, import_react.useState)("Untitled scene");
  const [selected, setSelected] = (0, import_react.useState)(null), [source, setSource] = (0, import_react.useState)(""), [preview, setPreview] = (0, import_react.useState)(""), [busy, setBusy] = (0, import_react.useState)(false), [error, setError] = (0, import_react.useState)(""), [notice, setNotice] = (0, import_react.useState)(""), [format, setFormat] = (0, import_react.useState)("glb"), [download, setDownload] = (0, import_react.useState)(null), [render, setRender] = (0, import_react.useState)("");
  const viewport = (0, import_react.useRef)(null), workspaceChosen = (0, import_react.useRef)(false);
  const [ready, setReady] = (0, import_react.useState)(false);
  const [width, setWidth] = (0, import_react.useState)(1280), [height, setHeight] = (0, import_react.useState)(720), [time, setTime] = (0, import_react.useState)(0), [playing, setPlaying] = (0, import_react.useState)(true);
  const dirty = Boolean(selected && source !== selected.source);
  const validFrame = Number.isInteger(width) && width >= 64 && width <= 4096 && Number.isInteger(height) && height >= 64 && height <= 4096 && Number.isFinite(time) && time >= 0 && time <= 86400;
  const startPreview = (url) => {
    setReady(false);
    setPlaying(true);
    setTime(0);
    setPreview(url);
  };
  const control = (command, value) => viewport.current?.contentWindow?.postMessage({ type: "bc3d-control", command, time: value }, "*");
  const refresh = async () => {
    const next = await request();
    setState(next);
    setWorkspace((current) => current || initialWorkspace(next.workspaces, context));
    return next;
  };
  (0, import_react.useEffect)(() => {
    let active = true;
    const load = () => request().then((value) => {
      if (active) {
        setState(value);
        setWorkspace((current) => current || initialWorkspace(value.workspaces, context));
      }
    }).catch((error2) => {
      if (active) setError(error2.message);
    });
    load();
    const timer = setInterval(load, 4e3);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  (0, import_react.useEffect)(() => {
    setReady(false);
    const receive = (event) => {
      if (event.source === viewport.current?.contentWindow && event.data?.type === "bc3d-ready") {
        setReady(true);
      } else if (event.source === viewport.current?.contentWindow && event.data?.type === "bc3d-state" && Number.isFinite(event.data.time) && event.data.time >= 0 && event.data.time <= 86400) {
        setPlaying(event.data.playing === true);
        setTime(event.data.time);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [preview]);
  (0, import_react.useEffect)(() => {
    if (!dirty) return;
    const guard = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  (0, import_react.useEffect)(() => {
    const sync = () => {
      if (!workspaceChosen.current && state.workspaces.length) setWorkspace(initialWorkspace(state.workspaces, context));
    };
    const sources = ["sessions", "workspaces"].map((name) => context?.get?.(name)?.list);
    const off = sources.map((source2) => source2?.subscribe?.(sync));
    sync();
    return () => off.forEach((dispose) => dispose?.());
  }, [context, state.workspaces]);
  const run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await action();
    } catch (error2) {
      setError(error2.message);
    } finally {
      setBusy(false);
    }
  };
  const args = () => ({ workspace: selected.workspace, engine: selected.engine, projectId: selected.id });
  const open = async (project) => {
    workspaceChosen.current = true;
    const loaded = await request({ action: "get", workspace: project.workspace, engine: project.engine, projectId: project.id });
    setSelected({ ...loaded, workspace: project.workspace });
    setSource(loaded.source);
    setPreview("");
    setPlaying(true);
    setTime(0);
    setRender("");
    setDownload(null);
    setFormat("glb");
    const result = await request({ action: "preview", workspace: project.workspace, engine: project.engine, projectId: project.id });
    startPreview(result.url);
    return loaded;
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "bc3d", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "3D Studio" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Create a scene, explore it, and take the source with you." })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bc3d-create", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "Workspace",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { "aria-label": "Workspace", value: workspace, disabled: busy || dirty, onChange: (event) => {
          workspaceChosen.current = true;
          setWorkspace(event.target.value);
          setSelected(null);
          setPreview("");
          setRender("");
          setDownload(null);
        }, children: state.workspaces.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: item.id, children: item.name }, item.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "Engine",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "Engine", value: engine, onChange: (event) => setEngine(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "three", children: "Three.js" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "babylon", children: "Babylon.js" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "Scene name",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { value: title, maxLength: 160, onChange: (event) => setTitle(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || dirty || !workspace || !title.trim(), onClick: () => run(async () => {
        const project = await request({ action: "create", workspace, engine, title });
        await refresh();
        await open({ ...project, workspace });
        setNotice("Scene created. Drag in the viewport to orbit.");
      }), children: "Create scene" })
    ] }),
    state.workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Open a workspace in BharatCode to save your 3D projects." }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "bc3d-notice", role: "status", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bc3d-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", { "aria-label": "Saved scenes", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "Saved scenes" }),
        state.projects.filter((project) => project.workspace === workspace).length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Your scenes will appear here." }),
        state.projects.filter((project) => project.workspace === workspace).map((project) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { disabled: busy || dirty, "aria-pressed": project.id === selected?.id, onClick: () => run(() => open(project)), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: project.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            project.engine === "three" ? "Three.js" : "Babylon.js",
            " \xB7 Revision ",
            project.revision
          ] })
        ] }, project.id))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", { children: selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bc3d-project", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: selected.title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
              "Revision ",
              selected.revision
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || dirty, onClick: () => run(async () => {
            const loaded = await open(selected);
            setNotice(`Preview built from revision ${loaded.revision}.`);
          }), children: "Update preview" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "bc3d-viewport", children: preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("iframe", { ref: viewport, title: `${selected.title} interactive 3D preview`, src: preview, sandbox: "allow-scripts allow-pointer-lock", allow: "fullscreen" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Building preview\u2026" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bc3d-playback", "aria-label": "Animation controls", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || !ready, onClick: () => {
            control(playing ? "pause" : "play");
            setPlaying(!playing);
          }, children: playing ? "Pause animation" : "Play animation" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "Animation time (seconds)",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "0", max: "86400", step: "0.05", value: Number.isNaN(time) ? "" : time, onChange: (event) => setTime(event.target.value === "" ? NaN : Number(event.target.value)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || !ready || !validFrame, onClick: () => {
            control("seek", time);
            setPlaying(false);
          }, children: "Seek to time" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Drag to orbit \xB7 Scroll to zoom" })
        ] }),
        dirty && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bc3d-draft", role: "status", children: [
          "Unsaved changes. Save and preview to use this draft, or ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy, onClick: () => {
            setSource(selected.source);
            setNotice("Draft discarded. Saved revision kept.");
          }, children: "Discard changes" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bc3d-toolbar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "Render width",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "64", max: "4096", step: "1", value: Number.isNaN(width) ? "" : width, onChange: (event) => setWidth(event.target.value === "" ? NaN : Number(event.target.value)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "Render height",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "number", min: "64", max: "4096", step: "1", value: Number.isNaN(height) ? "" : height, onChange: (event) => setHeight(event.target.value === "" ? NaN : Number(event.target.value)) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || dirty || !validFrame, onClick: () => run(async () => {
            const result = await request({ action: "render", ...args(), width, height, time });
            setRender(result.downloadURL);
            setDownload(result);
            setNotice(`Rendered revision ${result.revision} at ${width} \xD7 ${height}, time ${time}s.`);
          }), children: "Render PNG" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "Export format",
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "Export format", value: format, onChange: (event) => setFormat(event.target.value), children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "glb", children: "3D model (.glb)" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "viewer", children: "Offline viewer (.zip)" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "source", children: "Editable source (.zip)" }),
              selected.engine === "babylon" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "babylon", children: "Babylon scene (.babylon)" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || dirty || !validFrame, onClick: () => run(async () => {
            const result = await request({ action: "export", ...args(), format, width, height, time });
            setDownload(result);
            setNotice(`Exported revision ${result.revision}.`);
          }), children: "Export" }),
          download && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", { href: download.downloadURL, download: true, children: [
            "Download ",
            download.format ?? "PNG"
          ] }),
          busy && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { role: "status", children: "Working\u2026" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "bc3d-help", children: "PNG and model exports capture the selected animation time. The offline viewer preserves the scene\u2019s animation; use DeepBlend Studio for a rendered MP4 animation." }),
        render && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("figure", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { alt: `${selected.title} rendered frame`, src: render }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("figcaption", { children: "Rendered frame" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "Edit scene source" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "bc3d-source", children: [
            "Scene module",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { spellCheck: "false", value: source, onChange: (event) => setSource(event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { disabled: busy || source === selected.source, onClick: () => run(async () => {
            const result = await request({ action: "update", ...args(), source, expectedRevision: selected.revision });
            setSelected({ ...result, workspace: selected.workspace });
            setRender("");
            setDownload(null);
            await refresh();
            const next = await request({ action: "preview", ...args() });
            startPreview(next.url);
            setNotice(`Saved revision ${result.revision}.`);
          }), children: "Save and preview" })
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bc3d-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "A place to build in three dimensions" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Create a scene above, or ask DeepSeek to build one with the Three.js or Babylon.js tools. Your editable projects and exports stay saved in this workspace." })
      ] }) })
    ] })
  ] });
}
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: "bc-3d-studio", order: 2, label: "3D Studio" }, () => import_react.default.createElement("span", { "aria-hidden": true }, "\u25C7")));
  ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "bc-3d-studio" }, () => import_react.default.createElement(StudioPage, { context: ctx })));
}
var styles = `.bc3d{width:100%;height:100%;overflow:auto;padding:24px;box-sizing:border-box;color:var(--dsw-alias-label-primary,inherit)}.bc3d *{box-sizing:border-box}.bc3d h2{font-size:26px;margin:0 0 6px}.bc3d h3{margin:0 0 8px}.bc3d p{line-height:1.55;max-width:68ch}.bc3d header p{margin:0 0 24px;color:var(--dsw-alias-label-secondary,inherit)}.bc3d button,.bc3d input,.bc3d select{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2,transparent);padding:8px 12px;min-width:0;max-width:100%}.bc3d button{cursor:pointer}.bc3d button:disabled{opacity:.5;cursor:default}.bc3d button:focus-visible,.bc3d input:focus-visible,.bc3d select:focus-visible,.bc3d summary:focus-visible,.bc3d textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#568cff);outline-offset:2px}.bc3d-create,.bc3d-toolbar,.bc3d-playback{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.bc3d label{display:flex;flex-direction:column;gap:6px;font-size:13px}.bc3d [role=alert]{color:var(--dsw-alias-error,#df5766);white-space:pre-wrap;overflow-wrap:anywhere}.bc3d-notice{min-height:1em;font-size:13px}.bc3d-body{display:grid;grid-template-columns:200px minmax(0,1fr);gap:24px}.bc3d aside{min-width:0}.bc3d aside button{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;margin:0 0 8px;padding:12px}.bc3d aside button[aria-pressed=true]{border-color:var(--dsw-alias-brand-primary,#568cff)}.bc3d aside span{font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}.bc3d main{min-width:0}.bc3d-project{display:flex;align-items:center;justify-content:space-between;gap:12px}.bc3d-project p{font-size:13px;margin:0 0 12px}.bc3d-viewport{height:clamp(300px,52vh,680px);background:#17202b;border-radius:var(--dsw-radius-sm,6px);overflow:hidden}.bc3d-viewport iframe{width:100%;height:100%;border:0}.bc3d-toolbar,.bc3d-playback{margin:16px 0}.bc3d-playback span,.bc3d-help{font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}.bc3d-toolbar input{width:110px}.bc3d-playback input{width:150px}.bc3d-draft{padding:12px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:6px}.bc3d a{color:var(--dsw-alias-brand-primary,#568cff)}.bc3d figure{margin:16px 0}.bc3d figure img{max-width:100%;max-height:420px;object-fit:contain}.bc3d figcaption{font-size:12px}.bc3d details{border-top:1px solid var(--dsw-alias-border-l2,#8886);padding-top:16px}.bc3d summary{cursor:pointer;margin-bottom:12px}.bc3d-source textarea{width:100%;min-height:320px;resize:vertical;font:13px/1.55 monospace;background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;border:1px solid var(--dsw-alias-border-l2,#8886);padding:14px;border-radius:var(--dsw-radius-sm,6px)}.bc3d-empty{padding:48px 24px;background:var(--dsw-alias-bg-layer-2,transparent)}@media(max-width:700px){.bc3d{padding:16px}.bc3d-body{grid-template-columns:1fr}.bc3d aside{display:flex;gap:8px;overflow:auto;align-items:start}.bc3d aside h3{display:none}.bc3d aside button{min-width:160px;width:auto}.bc3d-viewport{height:360px}}`;
return module.exports;}});
