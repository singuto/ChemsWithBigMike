import type { Equipment, InventoryItem, StartingChemsFile } from '../types'

const CONTAINER_REAGENTS: Record<string, string> = {
  PlasmaChemistryVial: 'Plasma',
  ChemistryBottleToxin: 'Toxin',
  DrinkLithiumFlask: 'Lithium',
  JugWeldingFuel: 'WeldingFuel',
}

function collectIds(items: InventoryItem[] | undefined, into: Set<string>): void {
  if (!items) return
  for (const item of items) {
    if (item.id) into.add(item.id)
    const mapped = CONTAINER_REAGENTS[item.container]
    if (mapped) into.add(mapped)
  }
}

export function dispenserReagents(data: StartingChemsFile, equipment: Equipment): Set<string> {
  const ids = new Set<string>()
  if (equipment.dispenser) {
    for (const reagent of data.dispenser.generatable) ids.add(reagent.id)
  }
  return ids
}

export function vendReagents(data: StartingChemsFile, equipment: Equipment): Set<string> {
  const ids = new Set<string>()
  if (equipment.chemVend) collectIds(data.chemVend.startingInventory, ids)
  return ids
}

export function accessibleReagents(data: StartingChemsFile, equipment: Equipment): Set<string> {
  const ids = dispenserReagents(data, equipment)
  for (const id of vendReagents(data, equipment)) ids.add(id)
  return ids
}
