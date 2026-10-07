import { app, BrowserWindow, ipcMain, Menu, protocol } from 'electron'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.setName('Chems with big mike')

function savePath() {
  return path.join(app.getPath('userData'), 'kobold.json')
}

function copyExistingSave() {
  const next = savePath()
  if (existsSync(next)) return
  const previous = path.join(app.getPath('appData'), 'Chemistry for Kobolds', 'kobold.json')
  if (!existsSync(previous)) return
  mkdirSync(path.dirname(next), { recursive: true })
  copyFileSync(previous, next)
}

function readSave() {
  try {
    return JSON.parse(readFileSync(savePath(), 'utf8'))
  } catch {
    return null
  }
}

function writeSave(json) {
  const file = savePath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, json)
  const fd = openSync(file, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function distRoot() {
  return path.join(__dirname, '../dist')
}

function windowFrom(event) {
  return BrowserWindow.fromWebContents(event.sender)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Chems with Big Mike',
    frame: false,
    backgroundColor: '#1a1611',
    icon: path.join(distRoot(), 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.loadURL('app://kobold/index.html')
}

app.whenReady().then(() => {
  const root = distRoot()
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = path.normalize(path.join(root, rel))
    if (file !== root && !file.startsWith(root + path.sep)) {
      return new Response('not found', { status: 404 })
    }
    try {
      const body = readFileSync(file)
      return new Response(body, {
        headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  Menu.setApplicationMenu(null)
  copyExistingSave()
  ipcMain.on('window:minimize', (event) => windowFrom(event)?.minimize())
  ipcMain.on('window:maximize', (event) => {
    const win = windowFrom(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', (event) => windowFrom(event)?.close())
  ipcMain.handle('kobold:load', () => readSave())
  ipcMain.on('kobold:save', (event, json) => {
    try {
      if (typeof json !== 'string') throw new Error('Save payload must be a JSON string')
      writeSave(json)
      event.returnValue = null
    } catch (err) {
      event.returnValue = err instanceof Error ? err.message : String(err)
    }
  })
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
