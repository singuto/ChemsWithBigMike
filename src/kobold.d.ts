import type { AppSave } from './storage'

export {}

declare global {
  interface Window {
    kobold?: {
      load: () => Promise<AppSave | null>
      save: (data: AppSave) => void
      minimize: () => void
      toggleMaximize: () => void
      close: () => void
    }
  }
}
