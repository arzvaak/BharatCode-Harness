/** Worker lifetime belongs to the plugin, including Monaco's shared worker clients. */
import workerSource from './monaco-worker.ts?raw'
export function configureMonacoWorkers(): () => void {
  const previous = globalThis.MonacoEnvironment
  const workers = new Set<Worker>()
  const urls = new Set<string>()
  const environment = {
    getWorker: (): Worker => {
      const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
      urls.add(url)
      const worker = new Worker(url)
      workers.add(worker)
      return worker
    },
  }
  globalThis.MonacoEnvironment = environment
  return () => {
    for (const worker of workers) worker.terminate()
    for (const url of urls) URL.revokeObjectURL(url)
    if (globalThis.MonacoEnvironment === environment) globalThis.MonacoEnvironment = previous
  }
}
