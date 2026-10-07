import { chmodSync, copyFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const release = path.join(path.dirname(fileURLToPath(import.meta.url)), '../release')
const image = readdirSync(release).find((name) => name.startsWith('Chems with big mike') && name.endsWith('.AppImage'))
if (!image) {
  console.error('No AppImage in release/')
  process.exit(1)
}

const icon = path.join(release, 'icon.svg')
copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/icon.svg'), icon)

const exec = path.join(release, image).replace(/["`$\\]/g, '\\$&')

const desktop = `[Desktop Entry]
Type=Application
Name=Chems with big mike
Comment=Starlight chemistry recipes
Exec="${exec}"
Icon=${icon}
Terminal=false
Categories=Utility;
`

const file = path.join(release, 'Chems with big mike.desktop')
writeFileSync(file, desktop)
chmodSync(file, 0o755)
console.log(file)
