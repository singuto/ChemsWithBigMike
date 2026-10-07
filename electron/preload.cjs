const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kobold', {
  load: () => ipcRenderer.invoke('kobold:load'),
  save: (data) => {
    const error = ipcRenderer.sendSync('kobold:save', JSON.stringify(data, null, 2))
    if (error) throw new Error(error)
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
})
