/** Specialist runtimes expose schemas only after an enabled capability is requested. */
import { canInstall } from './contracts.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { capabilityState } from './capability-state.js';
export { capabilityState } from './capability-state.js';
export function registerDisclosure(ctx, { store, runtime, workspaceFor, credentials }) {
  const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
  ctx.tools.register(defineTool({ name: 'capability_search', description: 'Find optional capabilities and their setup state. File and search tools remain available. Only enabled, qualified extensions can be loaded.',
    parameters: { query: { type: 'string', required: true } }, output,
    async execute({ query }, exec) {
      if (!exec.agent) throw Error('Capability discovery requires an owning session');
      const workspace = workspaceFor(exec.agent.id);
      const entries = store.catalog.entries.filter(entry => `${entry.id} ${entry.name} ${entry.description} ${(entry.workflows ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
      const capabilities = await Promise.all(entries.map(async entry => {
        const installed = store.installed.find(record => record.id === entry.id);
        const enabled = entry.scope === 'profile' ? installed?.enabled === true : runtime.enabled.has(JSON.stringify([workspace, entry.id]));
        const dependencies = await store.inspectEntryDependencies(installed?.descriptor ?? entry, exec.signal);
        const credential = !entry.credentialReference || Boolean(await credentials(entry.credentialReference));
        return { id: entry.id, title: entry.name, ...capabilityState({ installed: Boolean(installed), enabled, qualified: installed ? canInstall(installed.descriptor, process.platform, store.options.bcVersion) : false, dependencies, credential, failure: runtime.failures?.get(JSON.stringify([workspace, exec.agent.id, entry.id])) }), dependencyIds: entry.dependencyIds ?? [], dependencyRanges: entry.dependencyRanges ?? {}, credentialReference: entry.credentialReference ?? null, deferred: entry.kind === 'mcp', toolCount: entry.tools?.length ?? 0 };
      }));
      return { capabilities, hasMore: capabilities.length === 30 };
    }
  }));
  ctx.tools.register(defineTool({ name: 'capability_load', description: 'Load the tools of an already enabled optional capability into this session. Returns exact tool names, schemas and schema-byte overhead. Setup failures do not silently load another provider.',
    parameters: { id: { type: 'string', required: true } }, output,
    async execute({ id }, exec) {
      if (!exec.agent) throw Error('Capability activation requires an owning session');
      const workspace = workspaceFor(exec.agent.id);
      const entry = runtime.enabled.get(JSON.stringify([workspace, id]));
      if (!entry) throw Error('Enable this capability in the extension store first');
      const schemas = await runtime.invoke(workspace, exec.agent.id, entry, 'discover', {}, exec.signal);
      return { id, schemas, schemaBytes: Buffer.byteLength(JSON.stringify(schemas), 'utf8') };
    }
  }));
}
