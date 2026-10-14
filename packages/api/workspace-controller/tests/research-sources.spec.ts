/** Structured imports must reject incomplete or unsafe feeds before evidence capture. */
import { expect, it } from 'vitest'
import { parseArxivFeed } from '../src/research-sources.ts'

it('rejects malformed, entity-bearing and API-error feeds instead of treating them as papers', () => {
  for (const input of [
    '<feed><entry>',
    '<!DOCTYPE feed [<!ENTITY payload "external">]><feed/>',
    '<feed><totalResults>1</totalResults><startIndex>0</startIndex><entry><id>http://arxiv.org/api/errors#badquery</id><title>Error</title><summary>Bad query</summary><published>today</published><updated>today</updated></entry></feed>',
    '<feed><title>Not a query result</title></feed>',
  ]) expect(() => parseArxivFeed(input)).toThrow()
})

it('preserves Unicode, authors and decoded abstracts in an empty or single-entry Atom page', () => {
  expect(parseArxivFeed('<feed><totalResults>0</totalResults><startIndex>0</startIndex></feed>')).toEqual({ totalResults: 0, start: 0, papers: [] })
  const page = parseArxivFeed('<feed><totalResults>1</totalResults><startIndex>0</startIndex><entry><id>https://arxiv.org/abs/cs/9901001v2</id><title>研究 &amp; agents</title><summary>A &lt; B</summary><published>1999-01-01</published><updated>1999-02-01</updated><author><name>홍길동</name></author><category term="cs.AI"/></entry></feed>')
  expect(page.papers[0]).toMatchObject({ id: 'cs/9901001', title: '研究 & agents', abstract: 'A < B', authors: ['홍길동'], categories: ['cs.AI'] })
})
