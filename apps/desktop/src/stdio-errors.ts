/**
 * A desktop can outlive the launcher reading its output. Ignore only broken-pipe
 * errors from those streams; unrelated I/O errors must retain their fatal behavior.
 */
export function installDesktopStdioErrorHandlers(): void {
  const onError = (error: NodeJS.ErrnoException): void => {
    if (error.code !== 'EPIPE') throw error
  }
  process.stdout.on('error', onError)
  process.stderr.on('error', onError)
}
