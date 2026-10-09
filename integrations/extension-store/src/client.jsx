import semver from "semver";
import React, { useEffect, useState } from "react";
export const inject = ["slots", "layout"];
async function request(action) {
  const response = await fetch("/api/bc-extension-store", {
    method: action ? "POST" : "GET",
    headers: action ? { "Content-Type": "application/json" } : {},
    credentials: "same-origin",
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? "Extension store unavailable");
  return value;
}
export function Store() {
  const [view, setView] = useState(),
    [tab, setTab] = useState("Extensions"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [connectionTokens, setConnectionTokens] = useState({}),
    [workspace, setWorkspace] = useState("");
  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      setView(await request(action));
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
  const qualifies = (e) =>
    e.status === "qualified" &&
    semver.satisfies(view.bcVersion, e.bcVersion, {
      includePrerelease: true,
    }) &&
    e.platforms.includes(view.platform) &&
    e.artifact &&
    ["packed-install", "lifecycle", "workflow"].every((x) =>
      e.qualification?.[view.platform]?.includes(x),
    );
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
        <summary>Private preview access</summary>
        <p>
          Use your own GitHub credential with read access to
          arzvaak/Bharatcode-Harness. It is saved in BC's credential store.
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
        Clear downloaded package cache
      </button>
      {view && <p role="status">{view.diagnostic}</p>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Working…</p>}
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
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent =
      ".bc-store{padding:24px;max-width:1200px;margin:auto;color:var(--dsh-text-primary,inherit)}.bc-store nav{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap}.bc-store label{display:inline-flex;gap:8px;margin:12px}.bc-store-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:20px}.bc-store-card{border:1px solid var(--dsh-border,#8886);border-radius:12px;padding:18px}.bc-store button{padding:8px 12px;margin:4px;cursor:pointer}.bc-store button:disabled{opacity:.5;cursor:default}.bc-store [role=alert]{color:var(--dsh-danger,#c44)}.bc-store-card p{overflow-wrap:anywhere}.bc-store-card li{margin-bottom:6px}";
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "bc-extensions",
        order: 1,
        label: () => "Extensions",
      },
      () => React.createElement("span", { "aria-hidden": true }, "＋"),
    ),
  );
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: "bc-extensions" }, Store),
  );
}
