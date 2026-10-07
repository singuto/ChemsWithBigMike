const { chmodSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  const name = 'chems-with-big-mike'
  const dir = context.appOutDir
  const bin = path.join(dir, name)
  const real = path.join(dir, `${name}.bin`)
  renameSync(bin, real)
  writeFileSync(
    bin,
    `#!/bin/sh\nHERE=$(dirname "$(readlink -f "$0")")\nexec "$HERE/${name}.bin" --no-sandbox "$@"\n`,
  )
  chmodSync(bin, 0o755)
}
