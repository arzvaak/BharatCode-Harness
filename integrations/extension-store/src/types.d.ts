/** Non-secret, signed extension release metadata. Artifact IDs refer to the fixed private repository. */
export interface ExtensionDescriptor {
  id: string;
  name: string;
  description?: string;
  kind: "native" | "mcp" | "skill" | "pack";
  version: string;
  source: string;
  sourceCommit?: string | null;
  license: string;
  scope: "profile" | "session";
  platforms: ("linux" | "win32" | "darwin" | "web")[];
  bcVersion: string;
  status:
    | "bundled"
    | "qualified"
    | "needs-qualification"
    | "needs-account"
    | "needs-adaptation"
    | "license-review"
    | "client-restricted"
    | "web-only";
  requirements: string[];
  dependencyIds?: ("node" | "python" | "jupyter" | "duckdb" | "typst" | "tinymist" | "ffmpeg")[];
  tools?: string[];
  packageName?: string;
  credentialReference?: string;
  artifact?: { assetId: number; bytes: number; sha256: string };
  qualification?: Partial<
    Record<"linux" | "win32" | "darwin" | "web", string[]>
  >;
  runtime?:
    | { transport: "stdio"; command: string; args?: string[] }
    | { transport: "streamable-http"; url: string };
  persistent?: boolean;
  components?: string[];
  rollbackFrom?: string[];
  updateFrom?: string[];
}
export interface CatalogRelease {
  schemaVersion: 1;
  revision: number;
  channel: "preview" | "stable";
  entries: ExtensionDescriptor[];
}
export interface InstalledExtension {
  id: string;
  descriptor: ExtensionDescriptor;
  previous?: ExtensionDescriptor;
  enabled: boolean;
  application: "applied" | "restart-required";
}
export interface InstalledState {
  schemaVersion: 1;
  records: InstalledExtension[];
  workspaceEnabled: [workspaceId: string, extensionId: string][];
}

/** Intent-bearing operations use the existing native manager; no independent installer. */
export type StoreOperation =
  | { action: "refresh" | "disconnect" | "clear-cache" }
  | { action: "connect"; token: string }
  | { action: "install" | "remove" | "rollback" | "inspect-dependencies" | "disconnect-extension"; id: string }
  | { action: "connect-extension"; id: string; token: string }
  | { action: "cancel"; requestId: string }
  | { action: "profile-enable"; id: string; enabled: boolean }
  | { action: "workspace-enable"; id: string; workspace: string; enabled: boolean };
export interface WorkspaceActivation { workspaceId: string; extensionId: string; enabled: boolean; }
export interface QualificationEvidence {
  platform: "linux" | "win32" | "darwin" | "web";
  sourceCommit: string;
  artifactSha256: string;
  check: "packed-install" | "lifecycle" | "workflow";
  result: "passed" | "failed" | "blocked";
  evidence: string;
}
