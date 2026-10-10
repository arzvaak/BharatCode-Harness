export function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
export function jsonOutput() {
    return { schema: { type: 'json' }, render: renderJson };
}
