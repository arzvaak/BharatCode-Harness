import { clientBundle } from './scripts/clientBundle.ts'

// Build both plugin faces from current source when DSH_BUILD_FACE is unset.
// Host: ESM index; client: minified closure factory with inline CSS Modules.
export default clientBundle('@kenz1117/dsh-engram', ['src/index.ts'], {
  lib: { dts: false },
})
