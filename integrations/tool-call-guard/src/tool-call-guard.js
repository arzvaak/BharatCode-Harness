/** Repair malformed historical tool calls only in the outbound request projection. */
export const name = 'tool-call-guard';
export const inject = ['llm'];

function flatten(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => typeof block === 'string' ? block : block?.type === 'text' ? block.text ?? '' : '').join('');
}

/** Preserve canonical messages and valid blocks, including mixed tool-result messages. */
export function projectMessages(messages) {
  const invalid = new Map();
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type !== 'tool-call') continue;
      try { JSON.parse(block.arguments); }
      catch { invalid.set(block.id, block.name ?? 'unknown'); }
    }
  }
  if (invalid.size === 0) return messages;
  return messages.map(message => {
    // V4 results use a first-class tool-role message, with call identity on
    // the message rather than a nested tool-result block.
    if (message.role === 'tool' && invalid.has(message.toolCallId)) {
      const { toolCallId, isError, ...rest } = message;
      return { ...rest, role: 'user', content: [{ type: 'text', text: `[Tool Result: ${invalid.get(toolCallId)}] ${flatten(message.content) || '(no output)'}` }] };
    }
    if (!Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map(block => {
      if (message.role === 'assistant' && block?.type === 'tool-call' && invalid.has(block.id)) {
        changed = true;
        return { type: 'text', text: `[Tool call ${block.name} removed from outbound history because its arguments were malformed JSON. Original arguments as emitted: ${block.arguments}]` };
      }
      if (message.role === 'user' && block?.type === 'tool-result' && invalid.has(block.toolCallId)) {
        changed = true;
        return { type: 'text', text: `[Tool Result: ${invalid.get(block.toolCallId)}] ${flatten(block.content) || '(no output)'}` };
      }
      return block;
    });
    return changed ? { ...message, content } : message;
  });
}

/** Intercept the shared LLM service across sibling plugin scopes; unload removes the listener. */
export function apply(ctx) {
  ctx.on('llm/stream', (options, next) => {
    if (Array.isArray(options.messages)) options.messages = projectMessages(options.messages);
    return next();
  }, { global: true, prepend: true });
}
