type RepositoryAction = "add" | "remove" | "refresh" | "detail" | "install" | "preview" | "update" | "rollback";
import type * as React from 'react';
import type { ApiCall, ApiRoutes, Translate, ModalProps, SourceSelectProps } from './client-types.js';
import type { InstallSource, Diagnostic } from './types.js';
type RepoView = ApiRoutes['/repositories']['repositories'][number];
type RepoSkill = RepoView['skills'][number];
type Feedback = {error?: boolean; payload?: unknown; key?: string; name?: string; text?: string};
type Installation = Feedback & {id: string; path: string; pending?: boolean};
type RepoModal = {type: 'add' | 'manage'} | {type: 'remove'; repo: RepoView} | {type: 'detail'; repo: RepoView; detail?: ApiRoutes['/repositories/detail']; loading?: boolean; failed?: boolean} | {type: 'review' | 'rollback'; repo: RepoView; skill: RepoSkill; detail: ApiRoutes['/repositories/preview']};
interface Dependencies {react: typeof React; Modal: React.ComponentType<ModalProps>; Input: React.ComponentType<any> & { TextArea: React.ComponentType<any> }; Button: React.ComponentType<any>; SourceSelect: React.ComponentType<SourceSelectProps>; api: ApiCall; headers: Record<string, string>; translateError: (t: Translate, error: unknown) => string}
import type { CodedError } from "./types.js";
// The repository page reuses the host skills panel components and reads the local directory cache only when the tab is opened.
export const repositoryLocales = {
  zh: {
    "repo.refreshing": "Checking updates…", "repo.refreshed": "Refresh and update check completed", "repo.detailLoading": "Loading skill instructions…",
    "repo.local": "Local", "repo.source": "Installed from", "repo.update": "Update available", "repo.review": "Review update", "repo.rollback": "Restore previous version", "repo.confirmUpdate": "Back up and update", "repo.confirmRollback": "Back up and restore", "repo.overwrite": "Back up local edits and replace", "repo.modified": "Local edits detected. Replacement overwrites current files and keeps a complete backup for restoration.", "repo.noChanges": "No file changes.", "repo.added": "Added", "repo.removed": "Removed", "repo.modifiedFile": "Modified", "repo.updating": "Updating…", "repo.updateProgress": "Verifying, backing up and replacing files. Please wait…", "repo.updateSuccess": "Updated. Previous version backed up.", "repo.rollbackSuccess": "Previous version restored.", "repo.manageUpdate": "Manage updates", "error.repo.modified": "Local edits detected. Review and confirm replacement with a backup.",
    "scope.repositories": "Repositories", "repo.add": "Add repository", "repo.manage": "Manage repositories", "repo.refresh": "Refresh & check updates", "repo.save": "Add and scan",
    "repo.hint": "Discover skills in public GitHub repositories and install them to global DSH.", "repo.footer": "Refresh checks repositories and skill updates without replacing local files. Historical backups are not cleaned automatically and use additional disk space.",
    "repo.search": "Search repository skills", "repo.all": "All repositories", "repo.states": "All statuses", "repo.available": "Available", "repo.installed": "Installed", "repo.conflict": "Name conflict", "repo.invalid": "Invalid format", "repo.install": "Install", "repo.detail": "Details",
    "repo.installing": "Installing…", "repo.installProgress": "Reading and verifying skill files. Please wait…", "repo.installSuccess": "Installed and enabled. Invoke it from the slash menu.",
    "repo.empty": "No repositories yet. Add a public GitHub repository to get started.", "repo.noSkills": "No matching skills. Refresh the repository or adjust your filters.",
    "repo.url": "Repository URL", "repo.ref": "Branch or tag (optional)", "repo.directory": "Skill subdirectory (optional)", "repo.defaultBranch": "Leave empty for the default branch", "repo.directoryHint": "For example: skills. Leave empty to scan the repository.",
    "repo.remove": "Remove repository", "repo.removeHint": "This removes the subscription only. Installed skills are kept.", "repo.removeConfirm": "Confirm removal", "repo.cancel": "Cancel", "repo.close": "Close", "repo.loading": "Working…", "repo.success": "Completed", "repo.installHint": "Skills may include scripts. Read the instructions and trust the source before installing. Resources are copied; scripts are not executed.", "repo.commit": "Snapshot version", "repo.notScanned": "Not scanned yet", "repo.updated": "Last refreshed",
    "error.repo.tooLarge": "Repository archive exceeds 32 MiB. Choose a smaller repository; a subdirectory filter does not reduce the download size.", "error.repo.installState": "Skill files were preserved but source tracking could not be saved. Restore disk write access and reopen Repositories to verify files and recover the record.",
    "error.repo.invalid": "Invalid repository URL, path or contents. Check the input and repository size.", "error.repo.network": "Repository request failed. Check your connection or retry later. The previous catalog was kept.", "error.repo.state": "Repository state is corrupt or unreadable. Preserve the file and repair it before retrying.", "error.repo.conflict": "A skill with this name exists or installation failed. Local files were not overwritten.", "error.repo.enableState": "The copied skill was removed because its enabled state could not be saved. Restore disk write access and install again.",
  },
  en: {
    "repo.refreshing": "Checking updates…", "repo.refreshed": "Refresh and update check completed", "repo.detailLoading": "Loading skill instructions…",
    "repo.local": "Local", "repo.source": "Installed from", "repo.update": "Update available", "repo.review": "Review update", "repo.rollback": "Restore previous version", "repo.confirmUpdate": "Back up and update", "repo.confirmRollback": "Back up and restore", "repo.overwrite": "Back up local edits and replace", "repo.modified": "Local edits detected. Replacement overwrites current files and keeps a complete backup for restoration.", "repo.noChanges": "No file changes.", "repo.added": "Added", "repo.removed": "Removed", "repo.modifiedFile": "Modified", "repo.updating": "Updating…", "repo.updateProgress": "Verifying, backing up and replacing files. Please wait…", "repo.updateSuccess": "Updated. Previous version backed up.", "repo.rollbackSuccess": "Previous version restored.", "repo.manageUpdate": "Manage updates", "error.repo.modified": "Local edits detected. Review and confirm replacement with a backup.",
    "scope.repositories": "Repositories", "repo.add": "Add repository", "repo.manage": "Manage repositories", "repo.refresh": "Refresh & check updates", "repo.save": "Add and scan",
    "repo.hint": "Discover skills in public GitHub repositories and install them to global DSH.", "repo.footer": "Refresh checks repositories and skill updates without replacing local files. Historical backups are not cleaned automatically and use additional disk space.",
    "repo.search": "Search repository skills", "repo.all": "All repositories", "repo.states": "All statuses", "repo.available": "Available", "repo.installed": "Installed", "repo.conflict": "Name conflict", "repo.invalid": "Invalid format", "repo.install": "Install", "repo.detail": "Details",
    "repo.installing": "Installing…", "repo.installProgress": "Reading and verifying skill files. Please wait…", "repo.installSuccess": "Installed and enabled. Invoke it from the slash menu.",
    "repo.empty": "No repositories yet. Add a public GitHub repository to get started.", "repo.noSkills": "No matching skills. Refresh the repository or adjust your filters.",
    "repo.url": "Repository URL", "repo.ref": "Branch or tag (optional)", "repo.directory": "Skill subdirectory (optional)", "repo.defaultBranch": "Leave empty for the default branch", "repo.directoryHint": "For example: skills. Leave empty to scan the repository.",
    "repo.remove": "Remove repository", "repo.removeHint": "This removes the subscription only. Installed skills are kept.", "repo.removeConfirm": "Confirm removal", "repo.cancel": "Cancel", "repo.close": "Close", "repo.loading": "Working…", "repo.success": "Completed", "repo.installHint": "Skills may include scripts. Read the instructions and trust the source before installing. Resources are copied; scripts are not executed.", "repo.commit": "Snapshot version", "repo.notScanned": "Not scanned yet", "repo.updated": "Last refreshed",
    "error.repo.tooLarge": "Repository archive exceeds 32 MiB. Choose a smaller repository; a subdirectory filter does not reduce the download size.", "error.repo.installState": "Skill files were preserved but source tracking could not be saved. Restore disk write access and reopen Repositories to verify files and recover the record.",
    "error.repo.invalid": "Invalid repository URL, path or contents. Check the input and repository size.", "error.repo.network": "Repository request failed. Check your connection or retry later. The previous catalog was kept.", "error.repo.state": "Repository state is corrupt or unreadable. Preserve the file and repair it before retrying.", "error.repo.conflict": "A skill with this name exists or installation failed. Local files were not overwritten.", "error.repo.enableState": "The copied skill was removed because its enabled state could not be saved. Restore disk write access and install again.",
  },
};

const CSS = `.dssm-repo-spinner{display:inline-block;width:12px;height:12px;margin-right:6px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dssm-repo-spin .8s linear infinite}@keyframes dssm-repo-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.dssm-repo-spinner{animation:none}}.dssm-repo-panel{display:flex;flex-direction:column;gap:12px;min-width:0}.dssm-repo-row{display:flex;align-items:center;gap:8px;padding:11px 13px;border-top:1px solid var(--dsw-alias-border-l1,#3a3a3a)}.dssm-repo-row:first-child{border-top:0}.dssm-repo-main{flex:1;min-width:0}.dssm-repo-description{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#a0a0a0);font-size:12px}.dssm-repo-filters{display:flex;gap:9px}.dssm-repo-filters>*{flex:1;min-width:0}.dssm-repo-panel .dssm-desc{margin:0}.dssm-repo-metadata{font-size:11px;color:var(--dsw-alias-label-tertiary,#a0a0a0);overflow-wrap:anywhere}.dssm-repo-panel .dssm-source{flex-shrink:0}@container(max-width:400px){.dssm-repo-filters{flex-wrap:wrap}.dssm-repo-filters>*{flex-basis:100%}.dssm-repo-row{flex-wrap:wrap}.dssm-repo-main{flex-basis:100%}}`;

/** Return the action and content areas while preserving the existing title and tab order. */
export function createRepositoryUI({ react, Modal, Input, Button, SourceSelect, api, headers, translateError }: Dependencies) {
  const h = react.createElement;
  return function useRepositoryUI({ active, t, onInstalled }: {active: boolean; t: Translate; onInstalled?: () => unknown}) {
    const [repos, setRepos] = react.useState<RepoView[]>([]);
    const [busy, setBusy] = react.useState(false);
    const [refreshing, setRefreshing] = react.useState<{id: string; name: string; index: number; total: number} | null>(null);
    const [feedback, setFeedback] = react.useState<Feedback | null>(null);
    const [installation, setInstallation] = react.useState<Installation | null>(null);
    const [query, setQuery] = react.useState("");
    const [source, setSource] = react.useState("");
    const [status, setStatus] = react.useState("");
    const [expanded, setExpanded] = react.useState<Record<string, boolean>>({});
    const [modal, setModal] = react.useState<RepoModal | null>(null);
    const [form, setForm] = react.useState<Record<string, string>>({ url: "", ref: "", subdirectory: "" });
    const locked = react.useRef(false);
    const mounted = react.useRef(true);
    react.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function load() { const data = await api("/repositories"); if (mounted.current) setRepos(data.repositories || []); }
    function message(error: unknown) {
      const item = error as Diagnostic & {message?: string};
      if (t("format.locale") === "zh-CN" && item.code === "error.repo.invalid") return item.error || item.message || t(item.code);
      return translateError(t, error) || item.message || String(error);
    }
    function feedbackText(value: Feedback) { return value.payload ? message(value.payload) : (value.key ? t(value.key) : value.text || "") + (value.name ? " · " + value.name : ""); }
    async function perform(task: () => Promise<unknown>, reload = true, quiet = false) {
      if (locked.current) return;
      locked.current = true; if (!quiet) { setBusy(true); setFeedback(null); }
      try { await task(); if (reload) await load(); }
      catch (caught) { const error = caught as CodedError; if (mounted.current) setFeedback({ error: true, payload: error }); }
      finally { locked.current = false; if (mounted.current) setBusy(false); }
    }
    function post<K extends RepositoryAction>(action: K, body: unknown) { return api(`/repositories/${action}` as `/repositories/${K}`, { method: "POST", headers, body: JSON.stringify(body) }); }
    async function refreshRepo(id: string) { const result = await post("refresh", { id }); if (result.error) setFeedback({ error: true, payload: result.error }); }
    function refresh(selected: RepoView[]) {
      return perform(async () => {
        let failed = false;
        try {
          for (let i = 0; i < selected.length; i++) {
            const repo = selected[i];
            setRefreshing({ id: repo.id, name: repo.owner + "/" + repo.name, index: i + 1, total: selected.length });
            const result = await post("refresh", { id: repo.id });
            if (result.error) { failed = true; setFeedback({ error: true, payload: result.error }); }
          }
          await load();
          if (!failed && mounted.current) setFeedback({ key: "repo.refreshed" });
        } finally { if (mounted.current) setRefreshing(null); }
      }, false);
    }
    function openDetail(repo: RepoView, skill: RepoSkill) {
      return perform(async () => {
        setModal({ type: "detail", repo, loading: true });
        try {
          const detail = await post("detail", { id: repo.id, path: skill.path });
          if (mounted.current) setModal({ type: "detail", detail, repo });
        } catch (caught) { const error = caught as CodedError; if (mounted.current) setModal({ type: "detail", repo, failed: true }); throw error; }
      }, false, true);
    }
    react.useEffect(() => { if (active) perform(load, false); }, [active]);
    function button(key: string, action: () => unknown, secondary = true, disabled = false) { return h(Button, { type: secondary ? "default" : "primary", disabled: busy || disabled, onClick: action }, t(key)); }
    function refreshButton(selected: RepoView[], row = false) {
      const pending = refreshing && (!row || refreshing.id === selected[0]?.id);
      return h(Button, { type: "default", disabled: busy || !selected.length, "aria-busy": !!pending, onClick: () => refresh(selected) },
        pending ? h("span", { className: "dssm-repo-spinner", "aria-hidden": true }) : null, t(pending ? "repo.refreshing" : "repo.refresh"));
    }
    function close() { if (!locked.current) setModal(null); }
    function install(repo: RepoView, skill: RepoSkill) {
      return perform(async () => {
        const target = { id: repo.id, path: skill.path };
        setInstallation({ ...target, pending: true, key: "repo.installProgress" });
        try {
          await post("install", target);
        } catch (caught) { const error = caught as CodedError;
          if (mounted.current) setInstallation({ ...target, error: true, payload: error });
          throw error;
        }
        if (!mounted.current) return;
        setInstallation({ ...target, key: "repo.installSuccess" });
        setFeedback({ key: "repo.installSuccess", name: skill.name });
        // A local list refresh failure must not report an already completed installation as failed.
        if (onInstalled) await onInstalled();
      });
    }
    function preview(repo: RepoView, skill: RepoSkill, rollback = false) {
      return perform(async () => {
        const detail = await post("preview", { id: repo.id, path: skill.path, rollback });
        setModal({ type: rollback ? "rollback" : "review", repo, skill, detail });
      });
    }
    function update() {
      if (!modal || (modal.type !== "review" && modal.type !== "rollback")) return;
      const selected = modal, rollback = selected.type === "rollback";
      return perform(async () => {
        const target = { id: selected.repo.id, path: selected.skill.path };
        setInstallation({ ...target, pending: true, key: "repo.updateProgress" });
        try {
          await post(rollback ? "rollback" : "update", { ...target, token: selected.detail.token, overwrite: selected.detail.localModified });
        } catch (caught) { const error = caught as CodedError;
          if (mounted.current) setInstallation({ ...target, error: true, payload: error });
          throw error;
        }
        if (!mounted.current) return;
        const key = rollback ? "repo.rollbackSuccess" : "repo.updateSuccess";
        setInstallation({ ...target, key }); setFeedback({ key }); setModal(null);
        if (onInstalled) await onInstalled();
      });
    }
    const actions = h("div", { key: "repository-actions", className: "dssm-actions" },
      refreshButton(repos),
      button("repo.add", () => { setFeedback(null); setForm({ url: "", ref: "", subdirectory: "" }); setModal({ type: "add" }); }, false),
      button("repo.manage", () => { setFeedback(null); setModal({ type: "manage" }); }));
    const visibleRepos = repos.filter((r) => !source || r.id === source);
    const groups = visibleRepos.map((repo) => {
      const search = query.trim().toLowerCase();
      const skills = repo.skills.filter((s) => (!status || s.status === status) && (!search || `${s.name} ${s.description} ${repo.owner}/${repo.name}`.toLowerCase().includes(search)));
      const open = expanded[repo.id] === undefined ? !!search || !!status : expanded[repo.id];
      const panelId = "dssm-repo-" + repo.id;
      return h("div", { key: repo.id, className: "dssm-source" },
        h("div", { className: "dssm-source-head" }, h("button", { type: "button", className: "dssm-source-head-main", "aria-expanded": open, "aria-controls": panelId, onClick: () => setExpanded({ ...expanded, [repo.id]: !open }) },
          h("span", { className: "dssm-source-chevron", "aria-hidden": true }, open ? "▾" : "▸"), h("span", { className: "dssm-source-title" }, repo.owner + "/" + repo.name), h("span", { className: "dssm-count" }, skills.length)),
        h("span", { className: "dssm-repo-metadata" }, repo.commit ? repo.commit.slice(0, 7) : t("repo.notScanned"))),
        repo.error ? h("div", { className: "dssm-feedback dssm-error", role: "alert" }, message(repo.error)) : null,
        h("div", { id: panelId, className: "dssm-source-body", hidden: !open }, open ? skills.length ? skills.map((skill) => h("div", { key: skill.path, className: "dssm-repo-row" },
          h("div", { className: "dssm-repo-main" }, h("div", { className: "dssm-name" }, skill.name), h("div", { className: "dssm-repo-description", title: skill.description }, skill.description),
            installation?.id === repo.id && installation.path === skill.path ? h("div", { className: "dssm-note" + (installation.error ? " dssm-error" : ""), role: installation.error ? "alert" : "status", "aria-live": "polite" }, feedbackText(installation)) : null),
          button("repo.detail", () => openDetail(repo, skill)),
          skill.tracked && (skill.updateAvailable || skill.status === "conflict") ? button("repo.review", () => preview(repo, skill)) : null,
          skill.canRollback ? button("repo.rollback", () => preview(repo, skill, true)) : null,
          button(installation?.id === repo.id && installation.path === skill.path && installation.pending ? "repo.installing" : skill.status === "available" ? "repo.install" : "repo." + skill.status, () => install(repo, skill), skill.status !== "available", skill.status !== "available"))) : h("div", { className: "dssm-empty" }, t("repo.noSkills")) : null));
    });
    function select(label: string, value: string, change: (value: string) => void, options: string[][]) {
      return h(SourceSelect, { label: t(label), value, onChange: change, options: [{ value: "", label: t(label) }, ...options.map(([id, text]) => ({ value: id, label: text }))] });
    }
    const feedbackNode = feedback ? h("div", { className: "dssm-feedback" + (feedback.error ? " dssm-error" : ""), role: "status" }, feedbackText(feedback)) : null;
    const refreshProgress = refreshing ? h("div", { className: "dssm-note", role: "status", "aria-live": "polite" }, t("repo.refreshing") + " " + refreshing.index + "/" + refreshing.total + " · " + refreshing.name) : null;
    let dialog;
    if (modal) {
      let body;
      if (modal.type === "review" || modal.type === "rollback") body = h("div", { className: "dssm-repo-panel" },
        h("div", { className: "dssm-name" }, modal.skill.name),
        h("div", { className: "dssm-repo-metadata" }, modal.repo.owner + "/" + modal.repo.name + " · " + modal.detail.commit?.slice(0, 7)),
        modal.detail.localModified ? h("p", { className: "dssm-feedback dssm-warning", role: "alert" }, t("repo.modified")) : null,
        modal.detail.changes.length ? h("ul", { style: { maxHeight: "240px", overflow: "auto", overflowWrap: "anywhere", paddingLeft: "20px" } }, modal.detail.changes.map(change => h("li", { key: change.path }, t("repo." + (change.kind === "modified" ? "modifiedFile" : change.kind)) + " · " + change.path))) : h("p", null, t("repo.noChanges")),
        busy ? h("div", { role: "status" }, t("repo.updateProgress")) : null, feedbackNode,
        h("div", { className: "dssm-modal-actions" }, button("repo.cancel", close), button(modal.detail.localModified ? "repo.overwrite" : modal.type === "rollback" ? "repo.confirmRollback" : "repo.confirmUpdate", update, false, !modal.detail.changes.length)));
      if (modal.type === "add") body = h("form", { className: "dssm-form", onSubmit: (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!form.url.trim()) return; perform(async () => { const repo = await post("add", form); await refreshRepo(repo.id); setModal(null); }); } },
        [["url", "repo.url", "https://github.com/owner/repo"], ["ref", "repo.ref", t("repo.defaultBranch")], ["subdirectory", "repo.directory", t("repo.directoryHint")]].map(([key, label, placeholder]) => h("label", { className: "dssm-field", key }, h("span", { className: "dssm-label" }, t(label)), h(Input, { "aria-label": t(label), value: form[key], placeholder, maxLength: key === "url" ? 2048 : 512, required: key === "url", disabled: busy, onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }) }))),
        feedbackNode, h("div", { className: "dssm-modal-actions" }, button("repo.cancel", close), button("repo.save", () => { if (form.url.trim()) perform(async () => { const repo = await post("add", form); await refreshRepo(repo.id); setModal(null); }); }, false, !form.url.trim())));
      if (modal.type === "manage") body = h("div", { className: "dssm-repo-panel" }, h("p", { className: "dssm-desc" }, t("repo.removeHint")), refreshProgress, feedbackNode, repos.length ? repos.map((repo) => h("div", { key: repo.id, className: "dssm-repo-row" },
        h("div", { className: "dssm-repo-main" }, h("div", { className: "dssm-name" }, repo.owner + "/" + repo.name), h("div", { className: "dssm-note" }, [repo.ref || t("repo.defaultBranch"), repo.subdirectory].filter(Boolean).join(" · ")), h("div", { className: "dssm-repo-metadata" }, repo.refreshedAt ? t("repo.updated") + " · " + new Date(repo.refreshedAt).toLocaleString(t("format.locale")) : t("repo.notScanned"))),
        refreshButton([repo], true), button("repo.remove", () => setModal({ type: "remove", repo })) )) : h("div", { className: "dssm-empty" }, t("repo.empty")));
      if (modal.type === "remove") body = h("div", null, h("p", { className: "dssm-desc" }, modal.repo.owner + "/" + modal.repo.name), h("p", { className: "dssm-desc" }, t("repo.removeHint")), feedbackNode,
        h("div", { className: "dssm-modal-actions" }, button("repo.cancel", () => setModal({ type: "manage" })), button("repo.removeConfirm", () => perform(async () => { await post("remove", { id: (modal as Extract<RepoModal, {type: "remove"}>).repo.id }); if (source === (modal as Extract<RepoModal, {type: "remove"}>).repo.id) setSource(""); setModal({ type: "manage" }); }), false)));
      if (modal.type === "detail" && modal.detail) body = h("div", { className: "dssm-repo-panel" }, h("div", { className: "dssm-name" }, modal.detail.name), h("p", { className: "dssm-desc" }, modal.detail.description), h("div", { className: "dssm-detail-path" }, modal.repo.owner + "/" + modal.repo.name + " · " + modal.detail.path), h("div", { className: "dssm-repo-metadata" }, t("repo.commit") + " · " + modal.detail.commit), h("p", { className: "dssm-note" }, t("repo.installHint")), h(Input.TextArea, { readOnly: true, value: modal.detail.body || "", autoSize: { minRows: 6, maxRows: 16 } }));
      if (modal.type === "detail" && !modal.detail) body = h("div", { role: "status", className: "dssm-repo-panel" }, modal.loading ? t("repo.detailLoading") : null, modal.failed ? feedbackNode : null);
      dialog = h(Modal, { title: t("repo." + (modal.type === "remove" ? "remove" : modal.type)), closeLabel: t("repo.close"), onClose: close }, body);
    }
    const content = h("div", { key: "repositories", id: "dssm-scope-panel", role: "tabpanel", "aria-labelledby": "dssm-tab-repositories", className: "dssm-repo-panel", "aria-busy": busy }, h("style", null, CSS),
      h("p", { className: "dssm-desc" }, t("repo.hint")),
      h("div", { className: "dssm-actions" }, ["arzvaak/BharatCode-Extensions", "vercel-labs/agent-skills", "anthropics/skills", "openai/skills"].map(url => h(Button, { key: url, disabled: busy, onClick: () => { setForm({ url, ref: "", subdirectory: "" }); setModal({ type: "add" }); } }, url)), h("a", { href: "https://skills.sh", target: "_blank", rel: "noreferrer" }, "Browse skills.sh")),
      h(Input, { className: "dssm-search", allowClear: true, "aria-label": t("repo.search"), placeholder: t("repo.search"), value: query, onChange: (e: { target: { value: string } }) => { setQuery(e.target.value); setExpanded({}); } }),
      h("div", { className: "dssm-repo-filters" }, select("repo.all", source, setSource, repos.map((r) => [r.id, r.owner + "/" + r.name])), select("repo.states", status, (value) => { setStatus(value); setExpanded({}); }, ["available", "installed", "update", "conflict", "invalid"].map((s) => [s, t("repo." + s)]))),
      feedbackNode, !modal ? refreshProgress : null, busy && !refreshing ? h("div", { className: "dssm-note", role: "status" }, t("repo.loading")) : null,
      repos.length ? groups : h("div", { className: "dssm-empty" }, t("repo.empty")), h("p", { className: "dssm-note" }, t("repo.footer")), dialog);
    return { actions, content, focusSource: (origin: InstallSource, name: string) => { setSource(origin.id); setQuery(name); setStatus(""); setExpanded({ [origin.id]: true }); } };
  };
}
