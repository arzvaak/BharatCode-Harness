import { join } from 'node:path'
import { Rolldown, type UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'
const bundle = clientBundle('@deepseek-ai/dsh-client-ui-workspace', ['lib/types/index.js'])
const workerPlugin: NonNullable<UserConfig['plugins']> = [
  {
    name: 'workspace-monaco-worker',
    resolveId(source) {
      return source === './monaco-worker.ts?raw' ? '\0workspace-monaco-worker' : null
    },
    async load(id) {
      if (id !== '\0workspace-monaco-worker') return null
      const worker = await Rolldown.rolldown({
        input: join(import.meta.dirname, 'src/client/workflows/monaco-worker.ts'),
        platform: 'browser',
      })
      try {
        const result = await worker.generate({ format: 'iife', minify: true })
        const chunk = result.output[0]
        if (chunk?.type !== 'chunk') throw new Error('Monaco worker did not emit a script')
        for (const path of Object.keys(chunk.modules)) this.addWatchFile(path)
        return `export default ${JSON.stringify(chunk.code)}`
      } finally {
        await worker.close()
      }
    },
  },
]
export default (options: Parameters<typeof bundle>[0]): UserConfig[] =>
  bundle(options).map((config) =>
    config.name?.endsWith('/client') === true ? { ...config, plugins: [config.plugins, workerPlugin] } : config,
  )
