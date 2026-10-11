/** Read-only, bounded Git change snapshots. No staging, reset, commit or shell expansion. */
import type { Context } from '@deepseek-ai/cordis'
export async function gitChange(ctx: Context, cwd: string, signal?: AbortSignal): Promise<{ commit: string; text: string }> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('Git review needs the local subprocess provider')
  const run = async (args: string[], allowed = [0]): Promise<string> => {
    const child = subprocess.spawn({
      argv: ['git', ...args],
      cwd,
      graceMs: 2000,
      ...(signal === undefined ? {} : { signal }),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 32 * 1024 } },
    })
    try {
      const outcome = await child.done
      signal?.throwIfAborted()
      const output = child.collected.stdout?.readFrom(0)
      if (!allowed.includes(outcome.exitCode ?? -1))
        throw new Error(child.collected.stderr?.readFrom(0).text || 'Git review failed')
      if (output === undefined || output.lossy) throw new Error('Git diff exceeds the complete capture limit')
      return output.text
    } finally {
      child.terminate()
      await child.waitForExit()
    }
  }
  const commit = (await run(['rev-parse', 'HEAD'])).trim()
  const tracked = await run(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'])
  const untracked = (await run(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  const additions: string[] = []
  for (const path of untracked)
    additions.push(
      await run(
        [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--binary',
          '--no-index',
          '--',
          process.platform === 'win32' ? 'NUL' : '/dev/null',
          path,
        ],
        [0, 1],
      ),
    )
  const text = `Commit: ${commit}\n${tracked}${additions.join('')}`
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Git diff exceeds the complete capture limit')
  return { commit, text }
}
