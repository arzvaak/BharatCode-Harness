/** Exact source offsets protect proposals from concurrent edits. */
export interface SelectedText {
  start: number
  end: number
  text: string
}
export interface EditProposal {
  base: string
  selection: SelectedText
  replacement: string
}
export function proposeEdit(base: string, selection: SelectedText, replacement: string): EditProposal {
  if (
    !Number.isInteger(selection.start) ||
    !Number.isInteger(selection.end) ||
    selection.start < 0 ||
    selection.end <= selection.start ||
    selection.end > base.length ||
    base.slice(selection.start, selection.end) !== selection.text
  )
    throw new Error('Selection no longer matches the document')
  return { base, selection: { ...selection }, replacement }
}
export function acceptEdit(current: string, proposal: EditProposal): string {
  if (current !== proposal.base) throw new Error('The document changed. Select the passage and review again.')
  return current.slice(0, proposal.selection.start) + proposal.replacement + current.slice(proposal.selection.end)
}
export function documentOutline(text: string): readonly { title: string; offset: number; level: number }[] {
  const result: { title: string; offset: number; level: number }[] = []
  let offset = 0
  let fence = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const match = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match && match[1] !== undefined && match[2] !== undefined)
      result.push({ title: match[2], offset, level: match[1].length })
    offset += line.length + 1
  }
  return result
}
