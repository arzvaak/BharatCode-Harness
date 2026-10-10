interface SourceMenuEscapeEvent {
  readonly key: string;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

/** An open filter or action menu captures Escape before it can close the dialog or host settings page. */
export function handleSourceMenuEscape(event: SourceMenuEscapeEvent, close: () => void) {
  if (event.key !== "Escape") return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  close();
  return true;
}
