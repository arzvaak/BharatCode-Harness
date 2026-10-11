/** Local notebook adapter executes captured inputs in a fresh directory. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { ArtifactRevision } from '@deepseek-ai/dsh-workspace/types'
import { z } from 'zod'
const resultSchema = z.object({
  notebook: z.string(),
  environment: z.string(),
  status: z.enum(['completed', 'failed']),
  detail: z.string(),
})
const script = `import json,sys,os,platform
import nbformat,nbclient
from nbclient import NotebookClient
from jupyter_client.kernelspec import KernelSpecManager
r=json.load(sys.stdin)
nb=nbformat.reads(r['notebook'],as_version=4)
nb.cells.insert(0,nbformat.v4.new_code_cell('parameters = '+repr(r['parameters'])+'\\nimport sys,platform,json\\nprint(\"__BC_KERNEL_ENV__\"+json.dumps({\"python\":sys.executable,\"version\":platform.python_version()}))'))
spec=KernelSpecManager().get_kernel_spec(r['kernel'])
if spec.language.lower() != 'python': raise ValueError('This adapter requires a Python kernel; configure another adapter for this language')
status='completed'; detail=''
try:
 NotebookClient(nb,timeout=r['timeout'],kernel_name=r['kernel'],resources={'metadata':{'path':r['cwd']}}).execute()
except Exception as e:
 status='failed'; detail=str(e)
observed={}
for output in nb.cells[0].get('outputs',[]):
 for line in output.get('text','').splitlines():
  if line.startswith('__BC_KERNEL_ENV__'): observed=json.loads(line[len('__BC_KERNEL_ENV__'):])
print(json.dumps({'notebook':nbformat.writes(nb),'environment':json.dumps({'runner':{'python':sys.executable,'version':platform.python_version(),'nbclient':nbclient.__version__,'nbformat':nbformat.__version__},'kernel':{'name':r['kernel'],'language':spec.language,'displayName':spec.display_name,'observed':observed}}),'status':status,'detail':detail}))
`
export async function executeCapturedNotebook(
  ctx: Context,
  request: {
    python: string
    timeout: number
    projectPath: string
    notebook: ArtifactRevision
    inputs: readonly ArtifactRevision[]
    kernel: string
    parameters: Record<string, string | number | boolean | null>
  },
  signal: AbortSignal,
): Promise<z.infer<typeof resultSchema>> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('Notebook execution needs the local subprocess provider')
  signal.throwIfAborted()
  const cwd = await mkdtemp(join(tmpdir(), 'bc-notebook-'))
  try {
    for (const input of request.inputs) {
      const path = relative(request.projectPath, resolve(request.projectPath, input.path))
      if (isAbsolute(path) || path === '..' || path.startsWith('../') || path.startsWith('..\\') || input.origin !== undefined)
        throw new Error('Notebook inputs must be captured project files')
      const target = join(cwd, path)
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, input.text, 'utf8')
    }
    const child = subprocess.spawn({
      argv: [request.python, '-c', script],
      cwd,
      graceMs: 2000,
      signal,
      stdio: {
        stdin: {
          data: JSON.stringify({
            notebook: request.notebook.text,
            parameters: request.parameters,
            kernel: request.kernel,
            timeout: request.timeout,
            cwd,
          }),
        },
        stdout: { maxBytes: 16 * 1024 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
    })
    try {
      const outcome = await child.done
      signal.throwIfAborted()
      const stdout = child.collected.stdout?.readFrom(0)
      const stderr = child.collected.stderr?.readFrom(0)
      if (outcome.exitCode !== 0) throw new Error(stderr?.text || `Notebook runner exited with ${outcome.exitCode}`)
      if (stdout === undefined || stdout.lossy) throw new Error('Notebook output exceeded the retention limit')
      return resultSchema.parse(JSON.parse(stdout.text))
    } finally {
      child.terminate()
      await child.waitForExit()
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
