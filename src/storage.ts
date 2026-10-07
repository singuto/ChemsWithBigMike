import type { Category, Equipment, SourceChoice } from './types'

const KEYS = {
  equipment: 'kobold.equipment',
  categories: 'kobold.categories',
  sources: 'kobold.sources',
  useSavedDefaults: 'kobold.useSavedDefaults',
  selectedId: 'kobold.selectedId',
} as const

export const defaultEquipment: Equipment = {
  dispenser: false,
  chemVend: false,
  chemVendExtra: false,
  capacity: 120,
  unit: 1,
  grinder: false,
  centrifuge: false,
  electrolysis: false,
}

export type AppSave = {
  equipment?: Partial<Equipment>
  categories?: Category[]
  sources?: Record<string, SourceChoice>
  useSavedDefaults?: boolean
  selectedId?: string
}

export type LoadedSave = {
  equipment: Equipment
  categories?: Category[]
  sources: Record<string, SourceChoice>
  useSavedDefaults: boolean
  selectedId: string
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function normalizeEquipment(saved: Partial<Equipment> | undefined): Equipment {
  if (!saved) return { ...defaultEquipment }
  return {
    dispenser: Boolean(saved.dispenser),
    chemVend: Boolean(saved.chemVend),
    chemVendExtra: Boolean(saved.chemVendExtra),
    capacity: typeof saved.capacity === 'number' && saved.capacity > 0 ? saved.capacity : 120,
    unit: saved.unit === 5 ? 5 : 1,
    grinder: Boolean(saved.grinder),
    centrifuge: Boolean(saved.centrifuge),
    electrolysis: Boolean(saved.electrolysis),
  }
}

export function cloneCategory(category: Category): Category {
  return {
    ...category,
    items: category.items.map((item) => ({ ...item })),
  }
}

function readLocal(): AppSave {
  return {
    equipment: readJson<Partial<Equipment>>(KEYS.equipment) ?? undefined,
    categories: readJson<Category[]>(KEYS.categories) ?? undefined,
    sources: readJson<Record<string, SourceChoice>>(KEYS.sources) ?? {},
    useSavedDefaults: readJson<boolean>(KEYS.useSavedDefaults) !== false,
    selectedId: localStorage.getItem(KEYS.selectedId) ?? '',
  }
}

function normalizeSave(raw: AppSave | null): LoadedSave {
  const categories = Array.isArray(raw?.categories) ? raw.categories.map(cloneCategory) : undefined
  return {
    equipment: normalizeEquipment(raw?.equipment),
    categories: categories && categories.length > 0 ? categories : undefined,
    sources: raw?.sources && typeof raw.sources === 'object' ? raw.sources : {},
    useSavedDefaults: raw?.useSavedDefaults !== false,
    selectedId: typeof raw?.selectedId === 'string' ? raw.selectedId : '',
  }
}

export async function loadPersisted(): Promise<LoadedSave> {
  if (window.kobold) return normalizeSave(await window.kobold.load())
  return normalizeSave(readLocal())
}

export function persistSave(state: {
  equipment: Equipment
  categories: Category[]
  sources: Record<string, SourceChoice>
  useSavedDefaults: boolean
  selectedId: string
}): void {
  if (window.kobold) {
    window.kobold.save(state)
    return
  }
  localStorage.setItem(KEYS.equipment, JSON.stringify(state.equipment))
  localStorage.setItem(KEYS.categories, JSON.stringify(state.categories))
  localStorage.setItem(KEYS.sources, JSON.stringify(state.sources))
  localStorage.setItem(KEYS.useSavedDefaults, JSON.stringify(state.useSavedDefaults))
  localStorage.setItem(KEYS.selectedId, state.selectedId)
}
