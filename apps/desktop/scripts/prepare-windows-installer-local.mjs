/** Cross-compile the production NSIS helper and raster assets on a Linux build host. */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function prepareWindowsInstallerLocal(output, env = process.env) {
  const toolchain = env.BC_WINDOWS_TOOLCHAIN_ROOT
  if (!toolchain) throw Error('Local Windows packaging requires BC_WINDOWS_TOOLCHAIN_ROOT')
  const installer = fileURLToPath(new URL('../installer', import.meta.url))
  mkdirSync(output, { recursive: true })
  execFileSync(join(toolchain, 'usr/bin/i686-w64-mingw32-g++'), [
    '-shared', '-static', '-Os', '-std=c++17', '-Wl,--kill-at', '-o', join(output, 'window-frame.dll'),
    join(installer, 'window-frame.cpp'), '-luser32', '-lcomctl32', '-ldwmapi', '-lgdiplus',
    '-lole32', '-lshell32', '-luuid', '-ladvapi32',
  ], { stdio: 'inherit', env })
  execFileSync('python3', ['-c', `
from pathlib import Path
from PIL import Image
import sys
source, output = map(Path, sys.argv[1:])
for name in ['brand', 'brand-2x', 'brand-dark', 'brand-dark-2x', 'uninstaller-sidebar']:
    image = Image.open(source / 'assets' / (name + '.png')).convert('RGBA')
    canvas = Image.new('RGB', image.size, (21,21,23) if 'dark' in name else (255,255,255))
    canvas.paste(image, mask=image.getchannel('A'))
    canvas.save(output / (name + '.bmp'))
`, installer, output], { stdio: 'inherit', env })
}
