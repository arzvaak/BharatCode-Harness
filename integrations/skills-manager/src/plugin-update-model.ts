export interface UpdatePayload { packageName: string; currentVersion: string; updateAvailable: boolean; profileName: string; canAutoUpdate: boolean; latestCheckFailed: boolean; latestVersion?: string; autoReload?: boolean }
type UpdatePhase = "idle" | "checking" | "updating";
type UpdateNotice = { type: "status" } | { type: "restart" } | { type: "restarting" } | { type: "error"; message: string };

const ZH = {
  check: "Check for updates", update: "Update", close: "Close", recheck: "Check again", auto: "Update automatically", updating: "Updating…", copy: "Copy command", copied: "Copied", copyFailed: "Copy failed",
  checking: "Checking for updates…", latest: "You are up to date", found: "New version available", failed: "Could not check for updates. Try again later.", current: "Running version", latestLabel: "Latest version", profile: "Target profile", unknown: "Unknown",
  manual: "Manual update", manualHint: "If automatic update fails, run this command in the current DSH terminal, then restart DSH Web.", intro: "Only this plugin is checked and updated. Other plugins are not changed.", restart: "Update complete. Restart DSH Web.", restarting: "Update complete. Restarting DSH Desktop…", unavailable: "Automatic update is unavailable. Use the manual command.",
};
const EN = {
  check: "Check for updates", update: "Update", close: "Close", recheck: "Check again", auto: "Update automatically", updating: "Updating…", copy: "Copy command", copied: "Copied", copyFailed: "Copy failed",
  checking: "Checking for updates…", latest: "You are up to date", found: "New version available", failed: "Could not check for updates. Try again later.", current: "Running version", latestLabel: "Latest version", profile: "Target profile", unknown: "Unknown",
  manual: "Manual update", manualHint: "If automatic update fails, run this command in the current DSH terminal, then restart DSH Web.", intro: "Only this plugin is checked and updated. Other plugins are not changed.", restart: "Update complete. Restart DSH Web.", restarting: "Update complete. Restarting DSH Desktop…", unavailable: "Automatic update is unavailable. Use the manual command.",
};
type UpdateStrings = { [Key in keyof typeof ZH]: string };

/** Use only the HTML language; the word “Settings” in page content must not switch a non-English UI to English. */
export function pluginUpdateCopy(lang: string): UpdateStrings {
  return lang.toLowerCase().startsWith("zh") ? ZH : EN;
}

export function describePluginUpdate(lang: string, payload: UpdatePayload | undefined, phase: UpdatePhase, notice: UpdateNotice) {
  const copy = pluginUpdateCopy(lang);
  const busy = phase !== "idle";
  let message = copy.checking;
  let kind = "";
  if (phase === "checking") message = copy.checking;
  else if (phase === "updating") message = copy.updating;
  else if (notice.type === "error") { message = notice.message || copy.failed; kind = "error"; }
  else if (notice.type === "restart") { message = copy.restart; kind = "success"; }
  else if (notice.type === "restarting") { message = copy.restarting; kind = "success"; }
  else if (payload === undefined) message = copy.checking;
  else if (payload.latestCheckFailed) { message = copy.failed; kind = "error"; }
  else if (!payload.canAutoUpdate && payload.updateAvailable) message = copy.unavailable;
  else if (payload.updateAvailable) message = `${copy.found}: v${payload.latestVersion ?? copy.unknown}`;
  else { message = copy.latest; kind = "success"; }
  return {
    copy, busy, message, kind, loading: phase === "updating",
    updateLabel: phase === "updating" ? copy.updating : copy.auto,
    disabled: busy || payload?.canAutoUpdate !== true || payload.updateAvailable !== true,
    currentVersion: payload === undefined ? copy.unknown : `v${payload.currentVersion}`,
    latestVersion: payload?.latestVersion === undefined ? copy.unknown : `v${payload.latestVersion}`,
    profileName: payload?.profileName ?? copy.unknown,
    profileRaw: payload?.profileName ?? "",
    latestRaw: payload?.latestVersion ?? "latest",
  };
}

export function createUpdateFlow(request: (method: "GET" | "POST") => Promise<UpdatePayload>, initial?: UpdatePayload, onPayload?: (value: UpdatePayload) => void) {
  let phase: UpdatePhase = "idle";
  let current = initial;
  let notice: UpdateNotice = { type: "status" };
  let posts = 0;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const assign = (next: UpdatePayload) => { current = next; onPayload?.(next); };
  return {
    get posts() { return posts; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    view(lang: string) { return describePluginUpdate(lang, current, phase, notice); },
    async check() {
      if (phase !== "idle") return;
      phase = "checking"; notice = { type: "status" }; emit();
      try { assign(await request("GET")); notice = { type: "status" }; }
      catch (error) { notice = { type: "error", message: error instanceof Error ? error.message : "" }; }
      finally { phase = "idle"; emit(); }
    },
    async update() {
      if (phase !== "idle") return;
      phase = "updating"; notice = { type: "status" }; posts += 1; emit();
      try {
        const next = await request("POST");
        assign(next);
        notice = { type: next.autoReload === true ? "restarting" : "restart" };
      } catch (error) { notice = { type: "error", message: error instanceof Error ? error.message : "" }; }
      finally { phase = "idle"; emit(); }
    },
  };
}

export function manualPluginUpdateCommand(profileName: string, packageName: string, version: string) {
  const profile = profileName.trim() === "" ? "" : ` --profile ${profileName.trim()}`;
  return `dsh plugin${profile} add ${packageName}@${version} --registry=https://registry.npmjs.org/`;
}

interface PluginUpdateEscapeEvent { readonly key: string; preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void }
export function handlePluginUpdateEscape(event: PluginUpdateEscapeEvent, close: () => void) {
  if (event.key !== "Escape") return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  close();
  return true;
}
