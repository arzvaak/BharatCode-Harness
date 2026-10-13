/** Native safe GFM/KaTeX reading with knowledge-owned link navigation. */
import { useEffect, useMemo, useRef } from 'react'
import { MarkdownText, MarkdownDelegateProvider, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { researchReadingText } from '@deepseek-ai/dsh-workspace/research-markdown'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResearchLink } from '@deepseek-ai/dsh-workspace/types'
import css from './research-knowledge.module.css'
export interface ResearchReaderProps extends PropsLocale<'workspace'> {
  text: string
  onLink: (link: Pick<ResearchLink, 'target' | 'wiki'>) => void
  images?: Readonly<Record<string, string>> | undefined
  heading?: string | undefined
}
/** The reader never normalizes source on disk or executes raw HTML. */
export function ResearchReader({ text, t, onLink, images = {}, heading }: ResearchReaderProps) {
  const article = useRef<HTMLElement>(null)
  const labels: MarkdownLabels = useMemo(
    () => ({
      code: { copyLabel: t('knowledge.copy'), copiedLabel: t('knowledge.copied') },
      footnotes: t('knowledge.references'),
    }),
    [t],
  )
  const rendered = useMemo(() => researchReadingText(text), [text])
  useEffect(() => {
    if (!heading) return
    const normalize = (value: string): string => value.trim().toLocaleLowerCase().replace(/\s+/g, '-')
    const target = [...(article.current?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? [])]
      .find(node => normalize(node.textContent) === normalize(heading))
    target?.scrollIntoView({ block: 'nearest' })
    target?.setAttribute('tabindex', '-1')
    target?.focus({ preventScroll: true })
  }, [heading, rendered])
  return (
    <article ref={article} className={css.reader} aria-label={t('knowledge.reader')}>
      <MarkdownDelegateProvider
        openFile={(path) => {
          if (path.startsWith('research-wiki/')) onLink({ target: path.slice('research-wiki/'.length), wiki: true })
          else if (path.startsWith('research-file/'))
            onLink({ target: path.slice('research-file/'.length), wiki: false })
          else onLink({ target: path, wiki: false })
        }}
      >
        <MarkdownText text={rendered} labels={labels} pathImages={{ resolve: value => images[value] }} />
      </MarkdownDelegateProvider>
    </article>
  )
}
