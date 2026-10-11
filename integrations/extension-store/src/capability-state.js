export function capabilityState({ installed, enabled, qualified, dependencies = [], credential = true, failure }) {
  if (failure) return { status: 'failed', requirements: [failure] };
  const requirements = [!installed && 'Install the extension', !qualified && 'Extension qualification is incomplete', ...dependencies.filter(d => !d.available).map(d => `${d.title}: ${d.reason ?? 'runtime required'}`), !credential && 'Connect the required account'].filter(Boolean);
  return { status: !enabled ? 'disabled' : requirements.length ? 'needs-setup' : 'ready', requirements };
}
