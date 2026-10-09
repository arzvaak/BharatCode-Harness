/** Validate and project an operation before it reaches privileged native services.
 * Unknown fields are ignored: clients cannot supply catalog requirements,
 * package paths, credential references or activation defaults.
 * @param {unknown} input
 * @returns {import('./types.js').StoreOperation}
 */
export function validateOperation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid extension operation');
  const { action } = input;
  const noFields = ['refresh', 'disconnect', 'clear-cache'];
  const extensionActions = ['install', 'remove', 'rollback', 'inspect-dependencies', 'setup-dependencies', 'remove-dependency', 'disconnect-extension', 'connect-extension', 'profile-enable', 'workspace-enable'];
  if (typeof action !== 'string' || ![...noFields, ...extensionActions, 'connect', 'cancel'].includes(action)) throw Error('Unknown extension operation');
  const result = { action };
  if (extensionActions.includes(action)) {
    if (typeof input.id !== 'string' || input.id.length > 4096 || !/^[-a-z0-9]+$/.test(input.id)) throw Error('Invalid extension ID');
    result.id = input.id;
  }
  if (action === 'remove-dependency') {
    if (typeof input.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/.test(input.version))
      throw Error('Invalid managed runtime version');
    result.version = input.version;
  }
  if (action === 'connect' || action === 'connect-extension') {
    const min = action === 'connect' ? 10 : 1, max = action === 'connect' ? 4096 : 16384;
    if (typeof input.token !== 'string' || input.token.trim().length < min || input.token.length > max) throw Error('Enter a connection credential');
    result.token = input.token;
  }
  if (action === 'cancel') {
    if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId)) throw Error('Invalid installation request');
    result.requestId = input.requestId;
  }
  if (action === 'profile-enable' || action === 'workspace-enable') {
    if (typeof input.enabled !== 'boolean') throw Error('Invalid activation choice');
    result.enabled = input.enabled;
  }
  if (action === 'workspace-enable') {
    if (typeof input.workspace !== 'string' || !input.workspace.trim() || input.workspace.length > 4096) throw Error('Invalid workspace');
    result.workspace = input.workspace;
  }
  return result;
}
