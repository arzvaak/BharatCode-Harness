// The host's native pi-ai adapter, settings Remote and credential service own
// all provider data and requests. This plugin adds a client configuration seat.
export const name = 'dsh-provider-hub';
export const inject = ['llm', 'settings'];
export function apply() {}
