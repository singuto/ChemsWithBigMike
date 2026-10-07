import { formatUnits, shortName, timesWord } from '../format'
import { formatDrugLabel, labelFor } from '../labels'
import { itemIncluded } from '../types'
import type {
  Category,
  BeforehandEntry,
  CmdEntry,
  CmdGroups,
  ExtraEntry,
  GrindYield,
  MaterialOption,
  MixReactant,
  MixStep,
  PlanStep,
  Recipe,
  RecipePlan,
  PourUnit,
  ReagentInfo,
  SourceChoice,
  UnresolvedBase,
  YieldInfo,
} from '../types'
import { pickRecipe, productOf, type MachineFlags, type RecipeIndex } from './graph'

const EPS = 1e-6

type ExpandArgs = {
  category: Category
  recipesByProduct: RecipeIndex
  access: Set<string>
  dispenser: Set<string>
  vend: Set<string>
  sources: Record<string, SourceChoice>
  sourceLabels: Record<string, string>
  names: Map<string, ReagentInfo>
  capacity: number
  unit: PourUnit
  machines: MachineFlags & { grinder: boolean }
  grinds: GrindYield[]
  mass?: boolean
}

function isLeaf(
  id: string,
  access: Set<string>,
  sources: Record<string, SourceChoice>,
  recipesByProduct: RecipeIndex,
  asTarget: boolean,
  machines: MachineFlags,
): boolean {
  if (access.has(id) || sources[id]) return true
  return !pickRecipe(id, recipesByProduct, asTarget, machines)
}

function activeItems(category: Category) {
  return category.items.filter((item) => item.amount > 0 && itemIncluded(item))
}

export function buildPlan(args: ExpandArgs): RecipePlan {
  const { category, recipesByProduct, access, dispenser, vend, sources, sourceLabels, names, capacity, unit, machines, grinds } =
    args
  const mass = args.mass ?? false
  const targets = activeItems(category)
  const needed = new Map<string, number>()
  const synthesized = new Set<string>()
  const visiting = new Set<string>()

  function markSynthesized(id: string, asTarget: boolean): void {
    if (isLeaf(id, access, sources, recipesByProduct, asTarget, machines)) return
    if (visiting.has(id)) return
    visiting.add(id)
    synthesized.add(id)
    const recipe = pickRecipe(id, recipesByProduct, asTarget, machines)
    if (!recipe) return
    for (const reactant of recipe.reactants) {
      markSynthesized(reactant.id, false)
    }
    visiting.delete(id)
  }

  const targetAmounts = new Map<string, number>()
  for (const item of targets) {
    needed.set(item.id, (needed.get(item.id) ?? 0) + item.amount)
    targetAmounts.set(item.id, (targetAmounts.get(item.id) ?? 0) + item.amount)
    markSynthesized(item.id, true)
  }
  if (mass) {
    for (const [id, amount] of targetAmounts) {
      needed.set(id, Math.max(needed.get(id) ?? 0, Math.max(amount, capacity)))
    }
  }

  const targetIds = new Set(targetAmounts.keys())
  const order = topoSynthesized(synthesized, recipesByProduct, targetIds, machines)
  const kBy = new Map<string, number>()
  const producedBy = new Map<string, number>()
  const demandBy = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const recipe = pickRecipe(id, recipesByProduct, targetIds.has(id), machines)
    if (!recipe) continue
    const product = productOf(recipe, id)
    const want = needed.get(id) ?? 0
    if (want <= EPS) continue
    const k = roundUpK(recipe, product.amount, want, unit, capacity, mass)
    const produced = product.amount * k
    kBy.set(id, k)
    producedBy.set(id, produced)
    demandBy.set(id, want)
    for (const reactant of recipe.reactants) {
      if (reactant.catalyst) continue
      needed.set(reactant.id, (needed.get(reactant.id) ?? 0) + reactant.amount * k)
    }
  }

  const catalystUsed = new Map<string, number>()
  const steps: MixStep[] = []
  const coProductExtras: ExtraEntry[] = []

  for (const id of order) {
    const recipe = pickRecipe(id, recipesByProduct, targetIds.has(id), machines)
    if (!recipe) continue
    const product = productOf(recipe, id)
    const k = kBy.get(id) ?? 0
    if (k <= EPS) continue

    const info = names.get(id)
    const mix = planMix(recipe, id, k, capacity, unit, mass)
    for (const [catId, amount] of mix.catalystTotals) {
      catalystUsed.set(catId, (catalystUsed.get(catId) ?? 0) + amount)
    }

    const usedLater = [...synthesized].some((other) => {
      if (other === id) return false
      const otherRecipe = pickRecipe(other, recipesByProduct, targetIds.has(other), machines)
      return otherRecipe?.reactants.some((r) => r.id === id) ?? false
    })
    const mixer = recipe.requiredMixerCategories[0]
    const isTarget = targetIds.has(id)
    const multiplier = product.amount > EPS ? mix.produced / product.amount : k
    const products = mixer ? scaledProducts(recipe, multiplier) : undefined
    if (products) {
      for (const output of products) {
        if (output.id === id || producedBy.has(output.id)) continue
        coProductExtras.push(output)
      }
    }
    steps.push({
      kind: mixer ? 'mixer' : 'mim',
      mixer,
      reagentId: id,
      title: info?.name ?? product.name,
      short: shortName(id, info?.name ?? product.name),
      color: info?.color ?? product.color,
      batches: mix.batches,
      reactants: mix.reactants,
      tail: mix.tail,
      output: isTarget && !usedLater ? 'jug' : 'cmd',
      bottle: isTarget && usedLater ? (mass ? Math.max(targetAmounts.get(id) ?? 0, capacity) : targetAmounts.get(id)) : undefined,
      produced: mix.produced,
      products,
      minTemp: recipe.minTemp,
      maxTemp: recipe.maxTemp,
    })
  }

  const leafIds = new Set<string>()
  for (const [id, amount] of needed) {
    if (amount <= EPS) continue
    if (!synthesized.has(id)) leafIds.add(id)
  }
  for (const id of catalystUsed.keys()) {
    if (!synthesized.has(id)) leafIds.add(id)
  }

  const yields = uniqueYields(grinds)
  const grindByReagent = indexGrinds(yields)
  const unresolved: UnresolvedBase[] = []
  const cmd: CmdEntry[] = []
  const beforehand: BeforehandEntry[] = []
  const plantSlots = new Map<string, PlantSlot>()
  const pathSteps: MixStep[] = []
  const grindSteps: MixStep[] = []
  const grindExtras: ExtraEntry[] = []

  const addCmd = (entry: CmdEntry) => {
    const existing = cmd.find((item) => item.id === entry.id)
    if (existing) existing.amount += entry.amount
    else cmd.push({ id: entry.id, name: entry.name, amount: entry.amount })
  }

  const addBeforehand = (entry: BeforehandEntry) => {
    const measure = entry.measure ?? 'u'
    const existing = beforehand.find((item) => item.id === entry.id && (item.measure ?? 'u') === measure)
    if (existing) {
      existing.amount += entry.amount
      if (!existing.sourceLabel && entry.sourceLabel) existing.sourceLabel = entry.sourceLabel
      return
    }
    beforehand.push({ ...entry, measure })
  }

  const addUnresolved = (entry: UnresolvedBase) => {
    const existing = unresolved.find((item) => item.id === entry.id)
    if (!existing) {
      unresolved.push(entry)
      return
    }
    existing.amount += entry.amount
    if (!existing.placeOptions) {
      existing.methods = methodsFor(existing.id, existing.amount, yields, recipesByProduct, unit, capacity, mass)
    }
  }

  for (const id of leafIds) {
    const fromNeeded = needed.get(id) ?? 0
    const fromCat = catalystUsed.get(id) ?? 0
    const amount = fromNeeded + fromCat
    if (amount <= EPS) continue
    const info = names.get(id)
    const name = info?.name ?? id
    const choice = sources[id]
    const fromMachine = access.has(id)
    if (choice && isMaterialChoice(choice.sourceId) && !fromMachine) {
      applyMaterial({
        id,
        name,
        amount,
        sourceId: choice.sourceId,
        yields,
        recipesByProduct,
        names,
        unit,
        capacity,
        mass,
        access,
        sources,
        sourceLabels,
        targetIds,
        synthesized,
        addCmd,
        addBeforehand,
        mixInput,
        addUnresolved,
        grindSteps,
        pathSteps,
        grindExtras,
      })
      continue
    }
    if (fromMachine) {
      addCmd({ id, name, amount })
      continue
    }
    if (choice) {
      addBeforehand({ id, name, amount, sourceLabel: sourceLabels[id] })
      addCmd({ id, name, amount })
      continue
    }
    const methods = methodsFor(id, amount, yields, recipesByProduct, unit, capacity, mass)
    const onlyItem = methods.length === 1 && methods[0].id.startsWith('item:') ? parseMaterial(methods[0].id) : null
    if (machines.grinder && onlyItem?.kind === 'item') {
      const plant = findYield(yields, onlyItem.method, onlyItem.plantId)
      const output = plant?.outputs.find((item) => item.id === id)
      if (plant && output && output.amount > EPS) {
        const plants = Math.max(1, Math.ceil((amount - EPS) / output.amount))
        const slot = plantSlots.get(slotKey(plant)) ?? {
          plant,
          plants: 0,
          demanded: new Map(),
        }
        slot.plants = Math.max(slot.plants, plants)
        slot.demanded.set(id, (slot.demanded.get(id) ?? 0) + amount)
        plantSlots.set(slotKey(plant), slot)
        continue
      }
    }
    addUnresolved({
      id,
      name,
      amount,
      methods,
      yieldInfo: methods.length ? undefined : previewFor(id, amount, grindByReagent, recipesByProduct),
    })
  }

  for (const slot of plantSlots.values()) {
    const { plant, plants } = slot
    const plantKey = `plant:${plant.id}`
    const plantSource = sources[plantKey]
    if (!plantSource) {
      unresolved.push({
        id: plantKey,
        name: plant.name,
        amount: plants,
        measure: 'count',
        placeOptions: [{ id: plant.sourceId, label: plant.sourceLabel }],
        yieldInfo: {
          kind: yieldKind(plant),
          line: grindLine(plant, 1),
          detail: itemDetail(plant.name, plants),
        },
      })
    }
    let produced = 0
    for (const output of plant.outputs) {
      const made = output.amount * plants
      const demand = slot.demanded.get(output.id) ?? 0
      if (demand > EPS) {
        produced += Math.min(made, demand)
        const put = mixInput(output.id, demand)
        if (put > EPS) addCmd({ id: output.id, name: output.name, amount: put })
      }
      if (made - demand > EPS) {
        grindExtras.push({ id: output.id, name: output.name, amount: made - demand })
      }
    }
    addBeforehand({
      id: plant.id,
      name: plant.name,
      amount: plants,
      measure: 'count',
      sourceLabel: plantSource ? sourceLabels[plantKey] : plant.sourceLabel,
    })
    grindSteps.push({
      kind: 'grind',
      method: plant.method === 'juice' ? 'juice' : 'grind',
      grindText: grindLine(plant, plants),
      reagentId: plant.id,
      title: plant.name,
      short: shortName(plant.id, plant.name),
      batches: plants,
      reactants: [],
      output: 'cmd',
      produced: produced || plant.outputs[0].amount * plants,
      minTemp: null,
      maxTemp: null,
    })
  }

  for (const step of steps) {
    if (step.kind !== 'mixer' || !isProcessMixer(step.mixer)) continue
    const want = mixInput(step.reagentId, demandBy.get(step.reagentId) ?? 0)
    if (want <= EPS) continue
    addCmd({ id: step.reagentId, name: step.title, amount: want })
  }

  cmd.sort((a, b) => a.name.localeCompare(b.name))
  const groupedCmd = groupCmd(cmd, dispenser, vend)
  beforehand.sort((a, b) => a.name.localeCompare(b.name))
  unresolved.sort((a, b) => a.name.localeCompare(b.name))

  const extraMap = new Map<string, ExtraEntry>()
  const addExtra = (entry: ExtraEntry) => {
    if (entry.amount <= EPS) return
    const current = extraMap.get(entry.id)
    if (current) current.amount += entry.amount
    else extraMap.set(entry.id, { ...entry })
  }
  for (const [id, produced] of producedBy) {
    addExtra({
      id,
      name: names.get(id)?.name ?? id,
      amount: produced - (demandBy.get(id) ?? 0),
    })
  }
  for (const entry of grindExtras) addExtra(entry)
  for (const entry of coProductExtras) addExtra(entry)
  const extra = [...extraMap.values()].sort((a, b) => a.name.localeCompare(b.name))

  function mixInput(id: string, amount: number): number {
    const target = targetAmounts.get(id) ?? 0
    const keep = mass && target > EPS ? Math.max(target, capacity) : target
    return keep > EPS ? Math.max(0, amount - keep) : amount
  }
  const heated = withHeat([...pathSteps, ...steps], recipesByProduct.explosions)
  const split = splitProcess(heated.steps)

  return {
    beforehand,
    process: [...grindSteps, ...split.process],
    unresolved,
    cmd: groupedCmd,
    steps: split.mixes,
    extra,
    warnings: heated.warnings,
    labels: drugLabels(category.id, targets.map((item) => item.id)),
    mass,
  }
}

function drugLabels(categoryId: string, ids: string[]): RecipePlan['labels'] {
  const seen = new Set<string>()
  const labels = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const label = labelFor(categoryId, id)
    if (!label) continue
    labels.push({ id, mark: label.mark, text: label.text, color: label.color })
  }
  return labels.sort((a, b) => a.text.localeCompare(b.text))
}

function isProcessMixer(mixer?: string): boolean {
  const name = mixer?.toLowerCase() ?? ''
  return name === 'centrifuge' || name === 'electrolysis'
}

function splitProcess(steps: PlanStep[]): { process: PlanStep[]; mixes: PlanStep[] } {
  const process: PlanStep[] = []
  const mixes: PlanStep[] = []
  let lead: PlanStep[] = []
  for (const step of steps) {
    if (step.kind === 'heat' || step.kind === 'cool') {
      lead.push(step)
      continue
    }
    const prep = step.kind === 'grind' || (step.kind === 'mixer' && isProcessMixer(step.mixer))
    const bucket = prep ? process : mixes
    bucket.push(...lead, step)
    lead = []
  }
  if (lead.length) mixes.push(...lead)
  return { process, mixes }
}

type GrindHit = { plant: GrindYield; outputAmount: number }
type PlantSlot = { plant: GrindYield; plants: number; demanded: Map<string, number> }

function isMaterialChoice(sourceId: string): boolean {
  return sourceId.startsWith('item:') || sourceId.startsWith('chain:') || sourceId.startsWith('reaction:')
}

function uniqueYields(grinds: GrindYield[]): GrindYield[] {
  const seen = new Set<string>()
  const out: GrindYield[] = []
  for (const plant of grinds) {
    const key = `${plant.method ?? 'grind'}:${plant.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(plant)
  }
  return out
}

function slotKey(plant: GrindYield): string {
  return `${plant.method ?? 'grind'}:${plant.id}`
}

function findYield(yields: GrindYield[], method: string, plantId: string): GrindYield | undefined {
  return yields.find((plant) => plant.id === plantId && (plant.method ?? 'grind') === method)
}

type ParsedMaterial =
  | { kind: 'item'; method: 'grind' | 'juice'; plantId: string }
  | { kind: 'chain'; method: 'grind' | 'juice'; plantId: string; recipeId: string }
  | { kind: 'reaction'; recipeId: string }

function parseMaterial(sourceId: string): ParsedMaterial | null {
  const parts = sourceId.split(':')
  if (parts[0] === 'item' && (parts[1] === 'grind' || parts[1] === 'juice') && parts[2]) {
    return { kind: 'item', method: parts[1], plantId: parts.slice(2).join(':') }
  }
  if (parts[0] === 'chain' && (parts[1] === 'grind' || parts[1] === 'juice') && parts.length >= 4) {
    return {
      kind: 'chain',
      method: parts[1],
      plantId: parts.slice(2, -1).join(':'),
      recipeId: parts[parts.length - 1],
    }
  }
  if (parts[0] === 'reaction' && parts[1]) {
    return { kind: 'reaction', recipeId: parts.slice(1).join(':') }
  }
  return null
}

function methodWord(method: 'grind' | 'juice'): string {
  return method === 'juice' ? ', juiced' : ', ground'
}

function productList(recipe: Recipe, multiplier: number, targetId: string): string {
  const products = [...recipe.products].sort((a, b) => {
    if (a.id === targetId) return -1
    if (b.id === targetId) return 1
    return 0
  })
  return products.map((product) => `${product.name} ${formatUnits(product.amount * multiplier)}`).join(', ')
}

function yieldsOf(yields: GrindYield[], reagentId: string): GrindYield[] {
  return yields.filter((plant) => plant.outputs.some((output) => output.id === reagentId && output.amount > EPS))
}

function methodsFor(
  id: string,
  amount: number,
  yields: GrindYield[],
  recipesByProduct: RecipeIndex,
  unit: PourUnit,
  capacity: number,
  mass = false,
): MaterialOption[] {
  const options: { id: string; label: string; sort: number }[] = []
  const seen = new Set<string>()
  const add = (option: { id: string; label: string; sort: number }) => {
    if (seen.has(option.id)) return
    seen.add(option.id)
    options.push(option)
  }

  for (const plant of yieldsOf(yields, id)) {
    const output = plant.outputs.find((item) => item.id === id)
    if (!output || output.amount <= EPS) continue
    const method = plant.method === 'juice' ? 'juice' : 'grind'
    const count = Math.max(1, Math.ceil((amount - EPS) / output.amount))
    add({
      id: `item:${method}:${plant.id}`,
      label: `${plant.name} ${formatUnits(count)}${methodWord(method)} → ${grindOutputs(plant, count)}`,
      sort: count,
    })
  }

  for (const recipe of recipesByProduct.producers.get(id) ?? []) {
    const product = productOf(recipe, id)
    if (!product || product.amount <= EPS) continue
    const inputs = recipe.reactants.filter((reactant) => !reactant.catalyst)
    const folded = inputs.length === 1 ? yieldsOf(yields, inputs[0].id) : []
    const multiplier = reactionMultiplier(recipe, id, amount, unit, capacity, mass)
    if (folded.length && inputs.length === 1) {
      const input = inputs[0]
      for (const plant of folded) {
        const perItem = plant.outputs.find((output) => output.id === input.id)?.amount ?? 0
        if (perItem <= EPS) continue
        const method = plant.method === 'juice' ? 'juice' : 'grind'
        const count = Math.max(1, Math.ceil((input.amount * multiplier - EPS) / perItem))
        add({
          id: `chain:${method}:${plant.id}:${recipe.id}`,
          label: `${plant.name} ${formatUnits(count)}${methodWord(method)} → ${productList(recipe, multiplier, id)}`,
          sort: count,
        })
      }
      continue
    }
    add({
      id: `reaction:${recipe.id}`,
      label: mass ? massReactionLabel(recipe, id, multiplier, unit, capacity) : scaledReaction(recipe, multiplier),
      sort: 100000 + multiplier,
    })
  }

  options.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  return options.map(({ id: optionId, label }) => ({ id: optionId, label }))
}

function reactionMultiplier(
  recipe: Recipe,
  productId: string,
  amount: number,
  unit: PourUnit,
  capacity: number,
  mass = false,
): number {
  const product = productOf(recipe, productId)
  const k = roundUpK(recipe, product.amount, amount, unit, capacity, mass)
  const mix = planMix(recipe, productId, k, capacity, unit, mass)
  if (product.amount <= EPS) return k
  return mix.produced / product.amount
}

function scaledReaction(recipe: Recipe, multiplier: number): string {
  const left = recipe.reactants
    .map((reactant) => {
      const amount = reactant.catalyst ? reactant.amount : reactant.amount * multiplier
      return `${reactant.name} ${formatUnits(amount)}${reactant.catalyst ? ' catalyst' : ''}`
    })
    .join(' + ')
  const right = recipe.products.map((product) => `${product.name} ${formatUnits(product.amount * multiplier)}`).join(', ')
  return `${left} → ${right}`
}

function grindOutputs(plant: GrindYield, count: number): string {
  return plant.outputs.map((output) => `${output.name} ${formatUnits(output.amount * count)}`).join(', ')
}

type ApplyArgs = {
  id: string
  name: string
  amount: number
  sourceId: string
  yields: GrindYield[]
  recipesByProduct: RecipeIndex
  names: Map<string, ReagentInfo>
  unit: PourUnit
  capacity: number
  mass: boolean
  access: Set<string>
  sources: Record<string, SourceChoice>
  sourceLabels: Record<string, string>
  targetIds: Set<string>
  synthesized: Set<string>
  addCmd: (entry: CmdEntry) => void
  addBeforehand: (entry: BeforehandEntry) => void
  mixInput: (id: string, amount: number) => number
  addUnresolved: (entry: UnresolvedBase) => void
  grindSteps: MixStep[]
  pathSteps: MixStep[]
  grindExtras: ExtraEntry[]
}

function applyMaterial(args: ApplyArgs): void {
  const parsed = parseMaterial(args.sourceId)
  if (!parsed) {
    args.addUnresolved({
      id: args.id,
      name: args.name,
      amount: args.amount,
        methods: methodsFor(args.id, args.amount, args.yields, args.recipesByProduct, args.unit, args.capacity, args.mass),
    })
    return
  }
  if (parsed.kind === 'item') {
    const plant = findYield(args.yields, parsed.method, parsed.plantId)
    const output = plant?.outputs.find((item) => item.id === args.id)
    if (!plant || !output || output.amount <= EPS) {
      args.addUnresolved({ id: args.id, name: args.name, amount: args.amount })
      return
    }
    const count = Math.max(1, Math.ceil((args.amount - EPS) / output.amount))
    pushItemStep(args, plant, count, new Map([[args.id, args.amount]]), true, true)
    return
  }
  const recipe = args.recipesByProduct.byId.get(parsed.kind === 'chain' ? parsed.recipeId : parsed.recipeId)
  if (!recipe) {
    args.addUnresolved({ id: args.id, name: args.name, amount: args.amount })
    return
  }
  const multiplier = reactionMultiplier(recipe, args.id, args.amount, args.unit, args.capacity, args.mass)
  if (parsed.kind === 'chain') {
    const plant = findYield(args.yields, parsed.method, parsed.plantId)
    const input = recipe.reactants.find((reactant) => !reactant.catalyst)
    const perItem = plant && input ? plant.outputs.find((output) => output.id === input.id)?.amount : 0
    if (!plant || !input || !perItem || perItem <= EPS) {
      args.addUnresolved({ id: args.id, name: args.name, amount: args.amount })
      return
    }
    const count = Math.max(1, Math.ceil((input.amount * multiplier - EPS) / perItem))
    const process = isProcessMixer(recipe.requiredMixerCategories[0])
    pushItemStep(args, plant, count, new Map([[input.id, input.amount * multiplier]]), !process)
  } else {
    for (const reactant of recipe.reactants.filter((item) => !item.catalyst)) {
      const need = reactant.amount * multiplier
      if (need <= EPS) continue
      const info = args.names.get(reactant.id)
      const name = info?.name ?? reactant.name
      const choice = args.sources[reactant.id]
      if (args.access.has(reactant.id)) {
        args.addCmd({ id: reactant.id, name, amount: need })
        continue
      }
      if (choice && !isMaterialChoice(choice.sourceId)) {
        args.addBeforehand({
          id: reactant.id,
          name,
          amount: need,
          sourceLabel: args.sourceLabels[reactant.id],
        })
        args.addCmd({ id: reactant.id, name, amount: need })
        continue
      }
      args.addUnresolved({
        id: reactant.id,
        name,
        amount: need,
        methods: methodsFor(reactant.id, need, args.yields, args.recipesByProduct, args.unit, args.capacity, args.mass),
      })
    }
  }
  pushReactionStep(args, recipe, multiplier)
}

function pushItemStep(
  args: ApplyArgs,
  plant: GrindYield,
  count: number,
  demanded: Map<string, number>,
  toCmd: boolean,
  trimTarget = false,
): void {
  let produced = 0
  for (const output of plant.outputs) {
    const made = output.amount * count
    const demand = demanded.get(output.id) ?? 0
    if (demand > EPS) produced += Math.min(made, demand)
    if (made - demand > EPS) {
      args.grindExtras.push({ id: output.id, name: output.name, amount: made - demand })
    }
    const put = trimTarget ? args.mixInput(output.id, demand) : demand
    if (toCmd && put > EPS) args.addCmd({ id: output.id, name: output.name, amount: put })
  }
  args.addBeforehand({
    id: plant.id,
    name: plant.name,
    amount: count,
    measure: 'count',
    sourceLabel: plant.sourceLabel,
  })
  args.grindSteps.push({
    kind: 'grind',
    method: plant.method === 'juice' ? 'juice' : 'grind',
    grindText: grindLine(plant, count),
    reagentId: plant.id,
    title: plant.name,
    short: shortName(plant.id, plant.name),
    batches: count,
    reactants: [],
    output: 'cmd',
    produced: produced || plant.outputs[0].amount * count,
    minTemp: null,
    maxTemp: null,
  })
}

function pushReactionStep(args: ApplyArgs, recipe: Recipe, multiplier: number): void {
  const product = productOf(recipe, args.id)
  const k = roundUpK(recipe, product.amount, args.amount, args.unit, args.capacity, args.mass)
  const mix = planMix(recipe, args.id, k, args.capacity, args.unit, args.mass)
  for (const [catId, catAmount] of mix.catalystTotals) {
    const info = args.names.get(catId)
    const name = info?.name ?? catId
    const choice = args.sources[catId]
    if (args.access.has(catId)) {
      args.addCmd({ id: catId, name, amount: catAmount })
    } else if (choice && !isMaterialChoice(choice.sourceId)) {
      args.addBeforehand({
        id: catId,
        name,
        amount: catAmount,
        sourceLabel: args.sourceLabels[catId],
      })
      args.addCmd({ id: catId, name, amount: catAmount })
    } else {
      args.addUnresolved({
        id: catId,
        name,
        amount: catAmount,
        methods: methodsFor(catId, catAmount, args.yields, args.recipesByProduct, args.unit, args.capacity, args.mass),
      })
    }
  }
  const info = args.names.get(args.id)
  if (isProcessMixer(recipe.requiredMixerCategories[0])) {
    const put = args.mixInput(args.id, args.amount)
    if (put > EPS) args.addCmd({ id: args.id, name: info?.name ?? product.name, amount: put })
  }
  const isTarget = args.targetIds.has(args.id)
  const usedLater = [...args.synthesized].some((other) => {
    if (other === args.id) return false
    const otherRecipe = pickRecipe(other, args.recipesByProduct, args.targetIds.has(other), {
      centrifuge: true,
      electrolysis: true,
    })
    return otherRecipe?.reactants.some((reactant) => reactant.id === args.id) ?? false
  })
  for (const output of recipe.products) {
    const made = output.amount * multiplier
    const demand = output.id === args.id ? args.amount : 0
    if (made - demand > EPS) {
      args.grindExtras.push({ id: output.id, name: output.name, amount: made - demand })
    }
  }
  args.pathSteps.push({
    kind: 'mixer',
    mixer: recipe.requiredMixerCategories[0],
    reagentId: args.id,
    title: info?.name ?? product.name,
    short: shortName(args.id, info?.name ?? product.name),
    color: info?.color ?? product.color,
    batches: mix.batches,
    reactants: mix.reactants,
    tail: mix.tail,
    output: isTarget && !usedLater ? 'jug' : 'cmd',
    produced: mix.produced,
    products: scaledProducts(recipe, multiplier),
    minTemp: recipe.minTemp,
    maxTemp: recipe.maxTemp,
  })
}

function indexGrinds(grinds: GrindYield[]): Map<string, GrindHit> {
  const byReagent = new Map<string, GrindHit>()
  for (const plant of grinds) {
    for (const output of plant.outputs) {
      const existing = byReagent.get(output.id)
      if (!existing || output.amount > existing.outputAmount) {
        byReagent.set(output.id, { plant, outputAmount: output.amount })
      }
    }
  }
  return byReagent
}

function grindLine(plant: GrindYield, count: number): string {
  const outs = plant.outputs.map((output) => `${output.name} ${formatUnits(output.amount * count)}`).join(', ')
  return `${plant.name} ${formatUnits(count)} → ${outs}`
}

function itemDetail(name: string, count: number): string {
  if (count === 1) return name
  return `${formatUnits(count)} × ${name}`
}

function yieldKind(plant: GrindYield): YieldInfo['kind'] {
  return plant.method === 'juice' ? 'juice' : 'grind'
}

function reactionLine(recipe: Recipe): string {
  const left = recipe.reactants
    .map((reactant) => `${reactant.name} ${formatUnits(reactant.amount)}${reactant.catalyst ? ' catalyst' : ''}`)
    .join(' + ')
  const right = recipe.products.map((product) => `${product.name} ${formatUnits(product.amount)}`).join(', ')
  return `${left} → ${right}`
}

function previewFor(
  id: string,
  amount: number,
  grindByReagent: Map<string, GrindHit>,
  recipesByProduct: RecipeIndex,
): YieldInfo | undefined {
  const grind = grindByReagent.get(id)
  if (grind) {
    const runs = Math.max(1, Math.ceil((amount - EPS) / grind.outputAmount))
    return {
      kind: yieldKind(grind.plant),
      line: grindLine(grind.plant, 1),
      detail: itemDetail(grind.plant.name, runs),
    }
  }
  const machines: ['centrifuge' | 'electrolysis', Map<string, Recipe>][] = [
    ['centrifuge', recipesByProduct.centrifuge],
    ['electrolysis', recipesByProduct.electrolysis],
  ]
  for (const [kind, map] of machines) {
    const recipe = map.get(id)
    if (!recipe) continue
    const product = productOf(recipe, id)
    const runs = Math.max(1, Math.ceil((amount - EPS) / product.amount))
    return {
      kind,
      line: reactionLine(recipe),
      detail: `${runs} ${runs === 1 ? 'run' : 'runs'}`,
    }
  }
  return undefined
}

function topoSynthesized(
  synthesized: Set<string>,
  recipesByProduct: RecipeIndex,
  targetIds: Set<string>,
  machines: MachineFlags,
): string[] {
  const indegree = new Map<string, number>()
  const edges = new Map<string, string[]>()
  for (const id of synthesized) {
    indegree.set(id, 0)
    edges.set(id, [])
  }
  for (const id of synthesized) {
    const recipe = pickRecipe(id, recipesByProduct, targetIds.has(id), machines)
    if (!recipe) continue
    for (const reactant of recipe.reactants) {
      if (!synthesized.has(reactant.id)) continue
      edges.get(reactant.id)!.push(id)
      indegree.set(id, (indegree.get(id) ?? 0) + 1)
    }
  }
  const queue = [...synthesized].filter((id) => (indegree.get(id) ?? 0) === 0)
  const out: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    out.push(id)
    for (const next of edges.get(id) ?? []) {
      const nextDeg = (indegree.get(next) ?? 1) - 1
      indegree.set(next, nextDeg)
      if (nextDeg === 0) queue.push(next)
    }
  }
  for (const id of synthesized) {
    if (!out.includes(id)) out.push(id)
  }
  return out
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b
}

function ceilToUnit(amount: number, unit: number): number {
  if (unit <= 1) return amount
  return Math.ceil((amount - EPS) / unit) * unit
}

function kStep(recipe: Recipe, unit: number): number {
  let step = 1
  const modulus = unit * 1000
  for (const reactant of recipe.reactants) {
    const milli = Math.round(reactant.amount * 1000)
    if (milli <= 0) continue
    step = lcm(step, modulus / gcd(milli, modulus))
  }
  return step
}

const EASY_POURS = [1, 5, 10, 15, 20, 30, 40, 60, 120]

function easyPours(unit: number): number[] {
  return EASY_POURS.filter((n) => n + EPS >= unit && Math.abs(n / unit - Math.round(n / unit)) <= 1e-6)
}

function snapUp(amount: number, unit: number): number {
  const hit = easyPours(unit).find((n) => n + 1e-4 >= amount)
  return hit ?? ceilToUnit(amount, unit)
}

function onEasy(amount: number, ladder: number[]): boolean {
  return ladder.some((n) => Math.abs(n - amount) <= 1e-3)
}

function easyMultiplier(recipe: Recipe, capacity: number, unit: number): number {
  const step = kStep(recipe, unit)
  const ladder = easyPours(unit)
  const cats = recipe.reactants.filter((reactant) => reactant.catalyst)
  const nonCats = recipe.reactants.filter((reactant) => !reactant.catalyst)
  const catVol = cats.reduce((sum, reactant) => sum + snapUp(reactant.amount, unit), 0)
  const room = Math.max(capacity - catVol, 0)
  const nonCatVol = nonCats.reduce((sum, reactant) => sum + reactant.amount, 0)
  if (nonCatVol <= EPS || step <= 0) return Math.max(step, 1)

  const maxPour = ladder[ladder.length - 1] ?? 120
  const maxByRoom = Math.floor((room + EPS) / nonCatVol / step) * step
  const maxByPour = Math.min(
    ...nonCats.map((reactant) =>
      reactant.amount > EPS ? Math.floor((maxPour + EPS) / reactant.amount / step) * step : step,
    ),
  )
  let best = 0
  if (maxByRoom >= step && maxByPour >= step) {
    const limit = Math.min(maxByRoom, maxByPour)
    for (let m = step; m <= limit + EPS; m += step) {
      const pours = nonCats.map((reactant) => reactant.amount * m)
      if (pours.every((pour) => onEasy(pour, ladder))) best = m
    }
  }
  if (best >= step) return best
  if (maxByRoom >= step) return maxByRoom
  return step
}

function roundUpK(
  recipe: Recipe,
  productAmount: number,
  want: number,
  unit: number,
  capacity = 0,
  mass = false,
): number {
  if (mass) {
    const m = easyMultiplier(recipe, capacity, unit)
    const per = productAmount * m
    if (per <= EPS) return m
    return m * Math.max(1, Math.ceil((want - EPS) / per))
  }
  const step = kStep(recipe, unit)
  const perStep = productAmount * step
  if (perStep <= EPS) return step
  return step * Math.max(1, Math.ceil((want - EPS) / perStep))
}

function scaleReactants(recipe: Recipe, k: number, unit: number): MixReactant[] {
  return recipe.reactants.map((r) => ({
    id: r.id,
    name: r.name,
    amount: r.catalyst ? ceilToUnit(r.amount, unit) : r.amount * k,
    catalyst: r.catalyst,
  }))
}

function scaleEasy(recipe: Recipe, m: number, unit: number): MixReactant[] {
  return recipe.reactants.map((r) => ({
    id: r.id,
    name: r.name,
    amount: r.catalyst ? snapUp(r.amount, unit) : r.amount * m,
    catalyst: r.catalyst,
  }))
}

function massReactionLabel(
  recipe: Recipe,
  productId: string,
  multiplier: number,
  unit: number,
  capacity: number,
): string {
  const mix = planMix(recipe, productId, multiplier, capacity, unit, true)
  const times = timesWord(mix.batches)
  const extra = times ? `, ${times}` : ''
  const right = recipe.products.map((product) => `${product.name} ${formatUnits(product.amount * multiplier)}`).join(', ')
  return `${reactantLine(mix.reactants)}${extra} → ${right}`
}

function planMix(recipe: Recipe, productId: string, k: number, capacity: number, unit: number, mass = false) {
  const product = productOf(recipe, productId)
  const cats = recipe.reactants.filter((r) => r.catalyst)
  const nonCats = recipe.reactants.filter((r) => !r.catalyst)
  if (mass) {
    const m = easyMultiplier(recipe, capacity, unit)
    const batches = m > EPS ? Math.max(1, Math.round(k / m)) : 1
    const catalystTotals = new Map<string, number>()
    for (const cat of cats) catalystTotals.set(cat.id, snapUp(cat.amount, unit) * batches)
    return {
      batches,
      reactants: scaleEasy(recipe, m, unit),
      produced: batches * m * product.amount,
      catalystTotals,
    }
  }
  const catVol = cats.reduce((s, r) => s + ceilToUnit(r.amount, unit), 0)
  const nonCatVol = nonCats.reduce((s, r) => s + r.amount, 0)
  const step = kStep(recipe, unit)

  let kMax = k
  if (nonCatVol > EPS) {
    const room = Math.max(capacity - catVol, 0)
    const fit = Math.floor((room + EPS) / nonCatVol / step) * step
    kMax = fit >= step ? fit : step
  }

  let mainK = k
  let batches = 1
  let tailK = 0
  if (k > kMax + EPS) {
    batches = Math.floor(k / kMax)
    tailK = k - batches * kMax
    mainK = kMax
    if (batches < 1) {
      batches = 1
      mainK = k
      tailK = 0
    }
  }

  const reactants = scaleReactants(recipe, mainK, unit)
  const tail = tailK > EPS ? scaleReactants(recipe, tailK, unit) : undefined
  const totalBatches = batches + (tail ? 1 : 0)

  const catalystTotals = new Map<string, number>()
  for (const cat of cats) {
    catalystTotals.set(cat.id, ceilToUnit(cat.amount, unit) * totalBatches)
  }

  return {
    batches,
    reactants,
    tail,
    produced: (mainK * batches + tailK) * product.amount,
    catalystTotals,
  }
}

function withHeat(mixes: MixStep[], explosions: Recipe[]): { steps: PlanStep[]; warnings: string[] } {
  const out: PlanStep[] = []
  const warnings: string[] = []
  const warned = new Set<string>()
  for (const step of mixes) {
    if (step.maxTemp != null) {
      out.push({ kind: 'cool', temp: step.maxTemp })
    }
    if (step.minTemp != null) {
      out.push({ kind: 'heat', temp: step.minTemp })
      for (const explosion of explosions) {
        if (warned.has(explosion.id) || explosion.minTemp == null) continue
        if (explosion.minTemp > step.minTemp + EPS) continue
        if (!explosionReactantsPresent(explosion, step)) continue
        warned.add(explosion.id)
        warnings.push(explosionWarning(explosion))
      }
    }
    out.push(step)
  }
  return { steps: out, warnings }
}

function explosionReactantsPresent(explosion: Recipe, step: MixStep): boolean {
  const present = new Set(step.reactants.map((reactant) => reactant.id))
  for (const reactant of step.tail ?? []) present.add(reactant.id)
  return explosion.reactants.every((reactant) => present.has(reactant.id))
}

function explosionWarning(explosion: Recipe): string {
  const names = explosion.reactants.map((reactant) => reactant.name)
  const list =
    names.length === 0
      ? explosion.id
      : names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const verb = names.length === 1 ? 'is' : 'are'
  return `Do not heat to ${formatUnits(explosion.minTemp ?? 0)}K or above while ${list} ${verb} in the beaker. That explodes.`
}

export function describeHeat(temp: number): string {
  return `heat  >${formatUnits(temp)}K`
}

export function describeCool(temp?: number): string {
  if (temp == null) return 'COOL your beaker'
  return `COOL your beaker below ${formatUnits(temp)}K`
}

function paperText(value: string): string {
  return value.replaceAll('[', '(').replaceAll(']', ')')
}

function colorHeatLine(line: string, temp: number | null): string {
  if (temp == null) return paperText(line)
  const prefix = describeHeat(temp)
  if (!line.startsWith(prefix)) return paperText(line)
  return `[color=#9a2f12]${prefix}[/color]${paperText(line.slice(prefix.length))}`
}

function stepTag(step: MixStep, chemMaster: boolean): string {
  if (step.kind === 'grind') return step.method === 'juice' ? 'JUICE' : 'GRIND'
  if (step.kind === 'mixer') return (step.mixer ?? 'MIXER').toUpperCase()
  return chemMaster ? 'MIM' : ''
}

export function describeBeforehand(entry: BeforehandEntry): string {
  const src = entry.sourceLabel ? ` — ${entry.sourceLabel}` : ''
  return `${entry.name} ${formatUnits(entry.amount)}${src}`
}

export function formatPaper(plan: RecipePlan, title: string, chemMaster = true): string {
  const blocks: string[] = [`[head=1]${paperText(title)}[/head]`]
  if (plan.mass) blocks.push('Easy batches')
  if (plan.beforehand.length) {
    blocks.push('[bold]Beforehand[/bold]')
    for (const entry of plan.beforehand) {
      blocks.push(`[bullet/] ${paperText(describeBeforehand(entry))}`)
    }
    blocks.push('')
  }
  appendPaperSteps(blocks, plan.process, chemMaster)
  blocks.push('[bold]Start here[/bold]', ...paperCmd(plan.cmd, chemMaster))
  const mixes = appendPaperSteps(blocks, plan.steps, chemMaster)
  if (mixes === 0) {
    blocks.push(
      '',
      paperText(
        chemMaster
          ? 'Nothing to mix — dump the listed chems and you are done.'
          : 'Nothing to mix — pour the listed chems and you are done.',
      ),
    )
  }
  if (plan.extra.length) {
    blocks.push('', '[bold]Extra[/bold]')
    for (const entry of plan.extra) {
      blocks.push(`[bullet/] ${paperText(entry.name)} ${formatUnits(entry.amount)}u`)
    }
  }
  for (const warning of plan.warnings) {
    blocks.push('', `[italic]${paperText(warning)}[/italic]`)
  }
  if (plan.labels.length) {
    blocks.push('', '[bold]Labels[/bold]')
    for (const label of plan.labels) {
      blocks.push(formatDrugLabel(label))
    }
  }
  return blocks.join('\n')
}

function appendPaperSteps(blocks: string[], steps: PlanStep[], chemMaster: boolean): number {
  let lead: string[] = []
  let mixes = 0
  for (const step of steps) {
    if (step.kind === 'heat') continue
    if (step.kind === 'cool') {
      lead.push(`[color=#1a4e8a]${describeCool(step.temp)}[/color]`)
      continue
    }
    mixes += 1
    const tag = stepTag(step, chemMaster)
    const heading = tag ? `${step.title} — ${tag}` : step.title
    blocks.push('', `[head=2]${paperText(heading)}[/head]`, ...lead, colorHeatLine(describeMix(step, chemMaster), step.minTemp))
    lead = []
  }
  if (lead.length) blocks.push('', ...lead)
  return mixes
}

export function describeCmd(entries: CmdEntry[], chemMaster = true): string {
  if (!entries.length) {
    return chemMaster
      ? 'Nothing to dump — all products are already on hand.'
      : 'Nothing to pour — all products are already on hand.'
  }
  const parts = entries.map((e) => `${e.name} ${formatUnits(e.amount)}`)
  return chemMaster ? `CMD ${parts.join(', ')}` : `Pour ${parts.join(', ')}`
}

export function cmdLine(entries: CmdEntry[]): string {
  return entries.map((entry) => `${entry.name} ${formatUnits(entry.amount)}`).join(', ')
}

function groupCmd(entries: CmdEntry[], dispenser: Set<string>, vend: Set<string>): CmdGroups {
  const groups: CmdGroups = { dispenser: [], vend: [], other: [] }
  for (const entry of entries) {
    if (dispenser.has(entry.id)) groups.dispenser.push(entry)
    else if (vend.has(entry.id)) groups.vend.push(entry)
    else groups.other.push(entry)
  }
  return groups
}

function paperCmd(groups: CmdGroups, chemMaster: boolean): string[] {
  const lines: string[] = []
  if (groups.dispenser.length) lines.push('[bold]Chem dispenser[/bold]', paperText(cmdLine(groups.dispenser)))
  if (groups.vend.length) lines.push('[bold]ChemVend[/bold]', paperText(cmdLine(groups.vend)))
  if (groups.other.length) lines.push(paperText(describeCmd(groups.other, chemMaster)))
  if (!lines.length) lines.push(paperText(describeCmd([], chemMaster)))
  return lines
}

function reactantLine(reactants: MixReactant[]): string {
  return [...reactants]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => {
      const cat = r.catalyst ? ' catalyst' : ''
      return `${r.name} ${formatUnits(r.amount)}${cat}`
    })
    .join(', ')
}

export function describeMix(step: MixStep, chemMaster = true): string {
  if (step.kind === 'grind' && step.grindText) return step.grindText
  const times = timesWord(step.batches)
  const extra = times ? `, ${times}` : ''
  const tail = step.tail?.length ? `, then ${reactantLine(step.tail)}` : ''
  const made = step.products?.length
    ? step.products.map((product) => `${product.name} ${formatUnits(product.amount)}`).join(', ')
    : undefined
  const bottle =
    step.bottle && step.bottle > 0
      ? chemMaster
        ? `, bottle ${formatUnits(step.bottle)}u → Jug`
        : `, set aside ${formatUnits(step.bottle)}u`
      : ''
  const body = made
    ? `${reactantLine(step.reactants)}${extra}${tail} → ${made}${bottle}`
    : `${reactantLine(step.reactants)}${extra}${tail} → ${!chemMaster ? 'beaker' : step.output === 'jug' ? 'Jug' : 'CMD'}${bottle}`
  if (step.minTemp == null) return body
  return `${describeHeat(step.minTemp)}, ${body}`
}

function scaledProducts(recipe: Recipe, multiplier: number): { id: string; name: string; amount: number }[] {
  return recipe.products.map((product) => ({
    id: product.id,
    name: product.name,
    amount: product.amount * multiplier,
  }))
}
