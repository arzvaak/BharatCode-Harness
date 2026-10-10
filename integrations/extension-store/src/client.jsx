import semver from "semver";
import { installationBlock } from "./eligibility.js";
import React, { useEffect, useState } from "react";
import { validateOperation } from "./operations.js";
import { en, NS, zh } from './locales.js';
import { isPythonDependency } from './dependency-groups.js';
export const inject = ["slots", "layout", "locale"];
async function request(action) {
  const response = await fetch("/api/bc-extension-store", {
    method: action ? "POST" : "GET",
    headers: action ? { "Content-Type": "application/json" } : {},
    credentials: "same-origin",
    ...(action ? { body: JSON.stringify(validateOperation(action)) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? "Extension store unavailable");
  return value;
}
export function Store({ t = key => key } = {}) {
  const [view, setView] = useState(),
    [tab, setTab] = useState("Extensions"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [connectionTokens, setConnectionTokens] = useState({}),
    [dependencyResults, setDependencyResults] = useState({}),
    [workspace, setWorkspace] = useState("");
  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      const next = await request(action);
      setView(next);
      if (next.inspectedDependencies) setDependencyResults(current => ({
        ...current, [next.inspectedDependencies.id]: next.inspectedDependencies.results,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (active)
        request()
          .then((x) => {
            if (active) setView(x);
          })
          .catch(() => {});
    }, 1500);
    request()
      .then((x) => {
        if (active) setView(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const entries = view?.catalog.entries ?? [];
  const installed = view?.installed ?? [];
  const qualifies = (e) => installationBlock(e, view) === undefined;
  const installedRequirements = (e) => e.kind === 'mcp' && (e.dependencyIds ?? []).length > 0
    && e.dependencyIds.every(id => dependencyResults[e.id]?.some(result =>
      result.id === id && result.available && result.managedSetup === 'installed'));
  const canSetUpRequirements = (e) => {
    if (e.kind !== 'mcp' || !(e.dependencyIds?.length > 0)
      || !dependencyResults[e.id]?.some(result => !result.available)) return false;
    const pythonIds = e.dependencyIds.filter(isPythonDependency);
    const otherIds = e.dependencyIds.filter(id => !pythonIds.includes(id));
    const bundles = view?.catalog.managedDependencies ?? [];
    return (!pythonIds.length || bundles.some(bundle => bundle.status === 'qualified' && bundle.platforms.includes(view.platform)
      && pythonIds.every(id => bundle.provides[id] && semver.satisfies(bundle.provides[id], e.dependencyRanges?.[id] ?? '*'))))
      && otherIds.every(id => bundles.some(bundle => bundle.status === 'qualified' && bundle.platforms.includes(view.platform)
        && bundle.provides[id] && semver.satisfies(bundle.provides[id], e.dependencyRanges?.[id] ?? '*')));
  };
  const dependencyStatusText = (status) => t(status === 'installed' ? 'dependencyManagedInstalled'
    : status === 'available' ? 'dependencyManagedAvailable' : 'dependencyLocalOnly');
  const filtered = entries.filter(
    (e) =>
      (tab === "Installed"
        ? installed.some((x) => x.id === e.id)
        : tab === "Workflow Packs"
          ? e.kind === "pack"
          : tab === "Connections"
            ? e.kind === "mcp"
            : e.kind !== "pack" && e.kind !== "mcp") &&
      `${e.name} ${e.description ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const rows = (list) =>
    list.map((e) => {
      const record = installed.find((x) => x.id === e.id);
      const blocked = installationBlock(e, view);
      return (
        <article key={e.id} className="bc-store-card">
          <h3>{e.name}</h3>
          <p>{e.description}</p>
          <p>
            <strong>{e.status.replaceAll("-", " ")}</strong> · {e.version} ·{" "}
            {e.scope === "profile"
              ? "Profile-wide activation"
              : "Workspace activation"}
          </p>
          {e.artifact && (
            <p>Download: {(e.artifact.bytes / 1024 / 1024).toFixed(1)} MiB</p>
          )}
          <ul>
            {e.requirements.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {e.dependencyIds?.length > 0 && <div>
            <button disabled={busy} onClick={() => run({ action: 'inspect-dependencies', id: e.id })}>Inspect local requirements</button>
            {dependencyResults[e.id]?.map(result => <p key={result.id}>
              {result.title}: {result.available ? `found ${result.version}` : result.reason}. {dependencyStatusText(result.managedSetup)}
            </p>)}
            {record && canSetUpRequirements(e) && <>
              <p>{t('managedRequirementsAvailable')}</p>
              <button disabled={busy || !qualifies(e)}
                onClick={() => run({ action: 'setup-dependencies', id: e.id })}>{t('setupManagedRequirements')}</button>
            </>}
            {record && installedRequirements(e) && <p>{t('managedRequirementsInstalled')}</p>}
          </div>}
          <p>
            <a href={e.source} target="_blank" rel="noreferrer">
              Upstream source
            </a>{" "}
            · Licence: {e.license}
          </p>
          {e.kind === "native" && (
            <p>Native host code runs with the application's host privileges.</p>
          )}
          {e.kind === "pack" ? (
            <details>
              <summary>Choose components</summary>
              {rows(entries.filter((x) => e.components.includes(x.id)))}
            </details>
          ) : (
            <div>
              {blocked && (!record || record.descriptor.version !== e.version) && <p>{t(blocked)}</p>}
              {record && e.scope === "session" && !workspace && <p>{t('selectWorkspaceToActivate')}</p>}
              {record && e.scope === "profile" && !record.enabled && <p>{t('installedInactive')}</p>}
              {!record ? (
                <button
                  disabled={busy || !qualifies(e)}
                  onClick={() => run({ action: "install", id: e.id })}
                >
                  Install
                </button>
              ) : (
                <>
                  <button
                    disabled={busy || (e.scope === "session" && !workspace)}
                    onClick={() =>
                      run(
                        e.scope === "profile"
                          ? {
                              action: "profile-enable",
                              id: e.id,
                              enabled: !record.enabled,
                            }
                          : {
                              action: "workspace-enable",
                              id: e.id,
                              workspace,
                              enabled: !view.workspaceEnabled.some(
                                ([w, id]) => w === workspace && id === e.id,
                              ),
                            },
                      )
                    }
                  >
                    {e.scope === "profile"
                      ? record.enabled
                        ? "Disable"
                        : "Enable profile-wide"
                      : view.workspaceEnabled.some(
                            ([w, id]) => w === workspace && id === e.id,
                          )
                        ? "Disable in workspace"
                        : "Enable in workspace"}
                  </button>
                  {record.descriptor.credentialReference && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const value = connectionTokens[e.id];
                        setConnectionTokens((current) => ({
                          ...current,
                          [e.id]: "",
                        }));
                        void run({
                          action: "connect-extension",
                          id: e.id,
                          token: value,
                        });
                      }}
                    >
                      <label>
                        Connector credential{" "}
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={connectionTokens[e.id] ?? ""}
                          onChange={(event) =>
                            setConnectionTokens((current) => ({
                              ...current,
                              [e.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button disabled={busy || !connectionTokens[e.id]}>
                        Save connection
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run({ action: "disconnect-extension", id: e.id })
                        }
                      >
                        Disconnect connector
                      </button>
                    </form>
                  )}
                  {record.descriptor.version !== e.version && (
                    <button
                      disabled={busy || !qualifies(e)}
                      onClick={() => run({ action: "install", id: e.id })}
                    >
                      Update to {e.version}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => run({ action: "rollback", id: e.id })}
                  >
                    Check rollback availability
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run({ action: "remove", id: e.id })}
                  >
                    Uninstall
                  </button>
                </>
              )}
            </div>
          )}
        </article>
      );
    });
  return (
    <section className="bc-store">
      <header>
        <h2>Extensions</h2>
        <p>
          Expand BC with tools and connected applications. Core graphics and
          workflow features are already included.
        </p>
      </header>
      <nav aria-label="Extension categories">
        {["Extensions", "Connections", "Workflow Packs", "Installed"].map(
          (t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ),
        )}
      </nav>
      <label>
        Search extensions{" "}
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <label>
        Workspace{" "}
        <select
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          <option value="">Select a workspace</option>
          {view?.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Optional GitHub access</summary>
        <p>
          Public extensions do not require a GitHub account. An optional credential
          increases GitHub download limits and is saved in BC's credential store.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = token;
            setToken("");
            void run({ action: "connect", token: value });
          }}
        >
          <input
            aria-label="GitHub credential"
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button disabled={busy || !token}>Connect GitHub</button>
        </form>
        <button disabled={busy} onClick={() => run({ action: "disconnect" })}>
          Disconnect
        </button>
      </details>
      <button disabled={busy} onClick={() => run({ action: "refresh" })}>
        Refresh signed catalog
      </button>
      <button disabled={busy} onClick={() => run({ action: "clear-cache" })}>
        {t('clearCaches')}
      </button>
      {view && <p role="status">{view.diagnostic}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Working…</p>}
      {!view && !error && <p role="status">{t('loadingCatalog')}</p>}
      {(view?.managedDependencies?.length ?? 0) > 0 && <details>
        <summary>{t('managedRuntimes')} ({view.managedDependencies.length})</summary>
        {view.managedDependencies.map(bundle => <p key={`${bundle.id}/${bundle.version}`}>
          {bundle.id} {bundle.version} · {Object.entries(bundle.provides).map(([id, version]) => `${id} ${version}`).join(', ')} · {bundle.verified ? bundle.license : t('unverifiedRuntime')}
          <button disabled={busy} onClick={() => run({ action: 'remove-dependency', id: bundle.id, version: bundle.version })}>{t('removeRuntime')}</button>
        </p>)}
      </details>}
      {view?.operations.map((id) => (
        <button
          key={id}
          onClick={() => run({ action: "cancel", requestId: id })}
        >
          Cancel installation
        </button>
      ))}
      {view?.archives.length > 0 && (
        <p>
          {view.archives.length} downloaded archives retained, including any
          failed installation downloads.
        </p>
      )}
      <div className="bc-store-grid">{rows(filtered)}</div>
      {view && filtered.length === 0 && <p>No extensions match this view.</p>}
    </section>
  );
}
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'bc-extension-store: dictionaries');
  const t = ctx.locale.bind(NS);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent =
      ".bc-store{flex:1;min-height:0;min-width:0;width:100%;height:100%;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;padding:24px;color:var(--dsw-alias-label-primary,inherit)}.bc-store nav{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap}.bc-store label{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px;max-width:100%;box-sizing:border-box;margin:12px 12px 12px 0}.bc-store input,.bc-store select{min-width:0;max-width:100%;box-sizing:border-box}.bc-store form{display:flex;align-items:center;flex-wrap:wrap;gap:4px}.bc-store h3,.bc-store li,.bc-store summary{overflow-wrap:anywhere}.bc-store-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px;margin-top:20px}.bc-store-card{min-width:0;border:1px solid var(--dsh-border,#8886);border-radius:12px;padding:18px}.bc-store button{max-width:100%;white-space:normal;overflow-wrap:anywhere;padding:8px 12px;margin:4px;cursor:pointer;font:inherit;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2,#8886);background:var(--dsw-alias-bg-layer-2,transparent);color:inherit}.bc-store button:focus-visible,.bc-store input:focus-visible,.bc-store select:focus-visible,.bc-store summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:2px}.bc-store button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,transparent)}.bc-store button:disabled{opacity:.5;cursor:default}.bc-store [role=alert]{color:var(--dsh-danger,#c44)}.bc-store-card p{overflow-wrap:anywhere}.bc-store-card li{margin-bottom:6px}@media(max-width:600px){.bc-store{padding:16px}.bc-store-card{padding:14px}}";
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "bc-extensions",
        order: 1,
        label: () => t('nav'),
        locale: NS,
      },
      () => React.createElement("span", { "aria-hidden": true }, "＋"),
    ),
  );
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: "bc-extensions", locale: NS, inject: () => ({ t }) }, Store),
  );
}
