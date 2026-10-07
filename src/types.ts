export type Reactant = {
  id: string
  name: string
  amount: number
  catalyst: boolean
}

export type Product = {
  id: string
  name: string
  amount: number
  group: string | null
  color: string
  desc: string
}

export type ReactionEffect = {
  type: string
}

export type Recipe = {
  id: string
  sourceFile: string
  minTemp: number | null
  maxTemp: number | null
  requiredMixerCategories: string[]
  reactants: Reactant[]
  products: Product[]
  reactionEffects?: ReactionEffect[]
}

export type ChemRecipesFile = {
  recipes: Recipe[]
}

export type InventoryItem = {
  container: string
  count?: number
  id?: string
  name?: string
  quantity?: number
}

export type StartingChemsFile = {
  dispenser: {
    loadedJugs: InventoryItem[]
    generatable: { id: string; name: string }[]
  }
  chemVend: {
    startingInventory: InventoryItem[]
  }
  chemVendExtra: {
    contrabandInventory: InventoryItem[]
    emaggedInventory: InventoryItem[]
    syndicate: {
      startingInventory: InventoryItem[]
      contrabandInventory: InventoryItem[]
    }
  }
  startingReagentIds: string[]
}

export type CategoryItem = {
  id: string
  amount: number
  optional?: boolean
  enabled?: boolean
}

export function itemIncluded(item: CategoryItem): boolean {
  if (item.enabled === false) return false
  if (item.enabled === true) return true
  return !item.optional
}

export type Category = {
  id: string
  name: string
  note?: string
  items: CategoryItem[]
}

export type DefaultCategoriesFile = {
  categories: Category[]
}

export type SourceOption = {
  id: string
  label: string
}

export type BaseSourcesFile = {
  always: SourceOption[]
  reagents: Record<string, SourceOption[]>
}

export type GrindOutput = {
  id: string
  name: string
  amount: number
}

export type GrindYield = {
  id: string
  name: string
  sourceId: string
  sourceLabel: string
  outputs: GrindOutput[]
  method?: 'grind' | 'juice'
  examples?: string[]
  variantCount?: number
}

export type GrindFile = {
  yields: GrindYield[]
}

export type PourUnit = 1 | 5

export type Equipment = {
  dispenser: boolean
  chemVend: boolean
  chemVendExtra: boolean
  grinder: boolean
  centrifuge: boolean
  electrolysis: boolean
  capacity: number
  unit: PourUnit
}

export type SourceChoice = {
  sourceId: string
  note?: string
}

export type ReagentInfo = {
  id: string
  name: string
  color?: string
  group?: string | null
}

export type YieldInfo = {
  kind: 'grind' | 'juice' | 'centrifuge' | 'electrolysis'
  line: string
  detail: string
}

export type MaterialOption = {
  id: string
  label: string
}

export type UnresolvedBase = {
  id: string
  name: string
  amount: number
  measure?: 'u' | 'count'
  yieldInfo?: YieldInfo
  placeOptions?: { id: string; label: string }[]
  methods?: MaterialOption[]
}

export type CmdEntry = {
  id: string
  name: string
  amount: number
  sourceLabel?: string
}

export type BeforehandEntry = {
  id: string
  name: string
  amount: number
  measure?: 'u' | 'count'
  sourceLabel?: string
}

export type MixReactant = {
  id: string
  name: string
  amount: number
  catalyst: boolean
}

export type HeatStep = {
  kind: 'heat'
  temp: number
}

export type CoolStep = {
  kind: 'cool'
  temp?: number
}

export type MixStep = {
  kind: 'mim' | 'mixer' | 'grind'
  mixer?: string
  method?: 'grind' | 'juice'
  grindText?: string
  reagentId: string
  title: string
  short: string
  color?: string
  batches: number
  reactants: MixReactant[]
  tail?: MixReactant[]
  output: 'cmd' | 'jug'
  bottle?: number
  produced: number
  products?: { id: string; name: string; amount: number }[]
  minTemp: number | null
  maxTemp: number | null
}

export type PlanStep = HeatStep | CoolStep | MixStep

export type ExtraEntry = {
  id: string
  name: string
  amount: number
}

export type DrugLabelLine = {
  id: string
  mark: string
  text: string
  color: string
}

export type CmdGroups = {
  dispenser: CmdEntry[]
  vend: CmdEntry[]
  other: CmdEntry[]
}

export type RecipePlan = {
  beforehand: BeforehandEntry[]
  process: PlanStep[]
  cmd: CmdGroups
  steps: PlanStep[]
  unresolved: UnresolvedBase[]
  extra: ExtraEntry[]
  warnings: string[]
  labels: DrugLabelLine[]
  mass: boolean
}
