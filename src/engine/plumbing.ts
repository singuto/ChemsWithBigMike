import { formatUnits, timesWord } from '../format'
import { itemIncluded, type Category, type GrindYield, type Recipe, type ReagentInfo, type SourceChoice, type UnresolvedBase } from '../types'
import { pickRecipe, productOf, type MachineFlags, type RecipeIndex } from './graph'
import { describeHeat } from './plan'

const CAPACITY = 120
const EPS = 1e-4

export type PlumbingChoice = 'steps' | 'pour1'

export type PlumbingPour = {
  id: string
  name: string
  amount: number
  catalyst: boolean
}

export type PlumbingStep = {
  kind: 'mix' | 'machine' | 'grind'
  productId: string
  productName: string
  productAmount: number
  pours: PlumbingPour[]
  minTemp: number | null
  maxTemp: number | null
  mixer?: string
  grindText?: string
  overCapacity: boolean
  pourUnit: number
  times?: number
  products?: { id: string; name: string; amount: number }[]
}

export type PlumbingGuide = {
  id: string
  name: string
  steps: PlumbingStep[]
}

export type PlumbingPending = {
  id: string
  name: string
  canSplit: boolean
}

export type PlumbingSupply = {
  id: string
  name: string
  amount: number
}

export type PlumbingSupplies = {
  dispenser: PlumbingSupply[]
  vend: PlumbingSupply[]
  outside: PlumbingSupply[]
}

export type PlumbingResult = {
  guides: PlumbingGuide[]
  pending: PlumbingPending[]
  unresolved: UnresolvedBase[]
  supplies: PlumbingSupplies
}

type Rxn = {
  recipe: Recipe
  productId: string
  productName: string
}

type Fail = {
  reactions: Rxn[]
  root: Rxn
}

type Rat = { n: bigint; d: bigint }

type Args = {
  category: Category
  recipesByProduct: RecipeIndex
  access: Set<string>
  dispenser: Set<string>
  vend: Set<string>
  sources: Record<string, SourceChoice>
  names: Map<string, ReagentInfo>
  machines: MachineFlags
  grinds: GrindYield[]
  choices: Record<string, PlumbingChoice>
  targets: Set<string>
}

export function buildPlumbing(args: Omit<Args, 'targets'>): PlumbingResult {
  const pending: PlumbingPending[] = []
  const items: { id: string; name: string }[] = []
  const seen = new Set<string>()
  for (const item of args.category.items) {
    if (item.amount <= 0 || !itemIncluded(item)) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    items.push({ id: item.id, name: args.names.get(item.id)?.name ?? item.id })
  }
  const full: Args = { ...args, targets: new Set(items.map((item) => item.id)) }
  const steps: PlumbingStep[] = []
  for (const item of targetOrder(
    items.map((entry) => entry.id),
    full,
  )) {
    const name = items.find((entry) => entry.id === item)?.name ?? item
    const built = compileMedicine(item, name, full)
    if (built.pending) pending.push(built.pending)
    else steps.push(...built.steps)
  }
  if (pending.length) {
    return { guides: [], pending, unresolved: collectUnresolved(steps, full), supplies: emptySupplies() }
  }
  const finished = attachGrinds(coverDownstream(orderByUse(steps)), full)
  const guides = finished.length ? [{ id: args.category.id, name: '', steps: finished }] : []
  return { guides, pending, unresolved: collectUnresolved(finished, full), supplies: gatherSupplies(finished, full) }
}

function emptySupplies(): PlumbingSupplies {
  return { dispenser: [], vend: [], outside: [] }
}

function unresolvedList(map: Map<string, UnresolvedBase>): UnresolvedBase[] {
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function targetOrder(ids: string[], args: Args): string[] {
  const wanted = new Set(ids)
  const visiting = new Set<string>()
  const done = new Set<string>()
  const sorted: string[] = []

  const walk = (id: string, asTarget: boolean) => {
    if (visiting.has(id)) return
    if (!asTarget && wanted.has(id)) {
      visit(id)
      return
    }
    if (!asTarget && (args.access.has(id) || forcedLeaf(id, args))) return
    const recipe = recipeFor(id, asTarget, args)
    visiting.add(id)
    if (recipe) {
      for (const reactant of recipe.reactants) {
        if (!reactant.catalyst) walk(reactant.id, false)
      }
    }
    visiting.delete(id)
    if (asTarget && !done.has(id)) {
      done.add(id)
      sorted.push(id)
    }
  }

  const visit = (id: string) => {
    if (!done.has(id)) walk(id, true)
  }

  for (const id of ids) visit(id)
  return sorted
}

function compileMedicine(
  id: string,
  name: string,
  args: Args,
): { steps: PlumbingStep[]; pending: PlumbingPending | null } {
  const choice = args.choices[id]
  const { steps, fails } = compileReagent(id, true, choice, args, new Set())
  if (fails.length && !choice) {
    return { steps: [], pending: { id, name, canSplit: fails.every((fail) => canSplit(fail, args)) } }
  }
  return { steps, pending: null }
}

function orderByUse(steps: PlumbingStep[]): PlumbingStep[] {
  const maker = new Map<string, number>()
  steps.forEach((step, index) => {
    const ids = step.products?.length ? step.products.map((product) => product.id) : [step.productId]
    for (const id of ids) if (!maker.has(id)) maker.set(id, index)
  })
  const after = steps.map(() => new Set<number>())
  const waiting = steps.map(() => 0)
  steps.forEach((step, index) => {
    for (const pour of step.pours) {
      if (pour.catalyst) continue
      const madeAt = maker.get(pour.id)
      if (madeAt == null || madeAt === index || after[madeAt].has(index)) continue
      after[madeAt].add(index)
      waiting[index] += 1
    }
  })
  const ready = steps.map((_, index) => index).filter((index) => waiting[index] === 0)
  const ordered: PlumbingStep[] = []
  while (ready.length) {
    ready.sort((a, b) => a - b)
    const index = ready.shift()
    if (index == null) break
    ordered.push(steps[index])
    for (const next of [...after[index]].sort((a, b) => a - b)) {
      waiting[next] -= 1
      if (waiting[next] === 0) ready.push(next)
    }
  }
  return ordered.length === steps.length ? ordered : steps
}

function coverDownstream(steps: PlumbingStep[]): PlumbingStep[] {
  const next = steps.map((step) => ({ ...step }))
  for (let i = next.length - 1; i >= 0; i--) {
    const step = next[i]
    if (step.kind === 'grind') continue
    const outs = step.products?.length
      ? step.products
      : [{ id: step.productId, name: step.productName, amount: step.productAmount }]
    let times = 1
    for (const out of outs) {
      if (out.amount <= EPS) continue
      let need = 0
      for (const later of next.slice(i + 1)) {
        for (const pour of later.pours) {
          if (!pour.catalyst && pour.id === out.id) need += pour.amount * (later.times ?? 1)
        }
      }
      if (need > out.amount + EPS) times = Math.max(times, Math.ceil((need - EPS) / out.amount))
    }
    if (times <= 1) continue
    next[i] = { ...step, times }
  }
  return next
}

function gatherSupplies(steps: PlumbingStep[], args: Args): PlumbingSupplies {
  const made = new Set<string>()
  for (const step of steps) {
    if (step.kind === 'grind') continue
    const ids = step.products?.length ? step.products.map((product) => product.id) : [step.productId]
    for (const id of ids) made.add(id)
  }
  const totals = new Map<string, PlumbingSupply & { bucket: keyof PlumbingSupplies }>()
  for (const step of steps) {
    const times = step.times ?? 1
    for (const pour of step.pours) {
      if (made.has(pour.id)) continue
      const bucket = args.dispenser.has(pour.id) ? 'dispenser' : args.vend.has(pour.id) ? 'vend' : 'outside'
      const amount = pour.amount * times
      const current = totals.get(pour.id)
      if (current) current.amount += amount
      else totals.set(pour.id, { id: pour.id, name: pour.name, amount, bucket })
    }
  }
  const supplies = emptySupplies()
  for (const entry of totals.values()) {
    supplies[entry.bucket].push({ id: entry.id, name: entry.name, amount: entry.amount })
  }
  for (const list of Object.values(supplies)) list.sort((a, b) => a.name.localeCompare(b.name))
  return supplies
}

function collectUnresolved(steps: PlumbingStep[], args: Args): UnresolvedBase[] {
  const made = new Set<string>()
  for (const step of steps) {
    if (step.kind === 'grind') continue
    const ids = step.products?.length ? step.products.map((product) => product.id) : [step.productId]
    for (const id of ids) made.add(id)
  }
  const unresolved = new Map<string, UnresolvedBase>()
  for (const step of steps) {
    for (const pour of step.pours) {
      if (pour.catalyst || args.access.has(pour.id) || args.sources[pour.id] || made.has(pour.id)) continue
      const existing = unresolved.get(pour.id)
      if (existing) existing.amount += pour.amount
      else unresolved.set(pour.id, { id: pour.id, name: pour.name, amount: pour.amount })
    }
  }
  return unresolvedList(unresolved)
}

function canSplit(fail: Fail, args: Args): boolean {
  if (fail.reactions.length < 2) return false
  return fail.reactions.every((rxn) => solve([rxn], rxn, 10, args).volume <= CAPACITY + EPS)
}

function packFits(reactions: Rxn[], root: Rxn, args: Args, pourUnit: number, chain: Rxn[]): Solved[] | null {
  const whole = solve(reactions, root, pourUnit, args)
  if (whole.volume <= CAPACITY + EPS && !mixConflicts(whole, args)) return [whole]
  if (reactions.length <= 1) return null
  const branches = branchesOf(reactions, root)
  if (!branches.length) return eachFits(reactions, args, pourUnit)
  const pieces: Solved[] = []
  for (const branch of branches) {
    const sub = packFits(branch, directRoot(branch, root), args, pourUnit, chain)
    if (!sub) return null
    pieces.push(...sub)
  }
  const rootOnly = solve([root], root, pourUnit, args)
  if (rootOnly.volume > CAPACITY + EPS) return null
  return absorbRoot(binMerge(pieces, args, chain), rootOnly, args, chain)
}

function absorbRoot(bins: Solved[], root: Solved, args: Args, chain: Rxn[]): Solved[] {
  const direct = new Set(
    root.root.recipe.reactants.filter((reactant) => !reactant.catalyst).map((reactant) => reactant.id),
  )
  const order = bins
    .map((bin, index) => ({ bin, index }))
    .filter(({ bin }) => bin.products.some((product) => direct.has(product.id)))
    .sort((a, b) => Number(b.bin.minTemp != null) - Number(a.bin.minTemp != null))
  const used = new Set<number>()
  let current = root
  for (const { bin, index } of order) {
    const merged = mergeSolved(current, bin, args, chain)
    if (!merged || merged.volume > CAPACITY + EPS) continue
    current = merged
    used.add(index)
  }
  return [...bins.filter((_, index) => !used.has(index)), current]
}

function eachFits(reactions: Rxn[], args: Args, pourUnit: number): Solved[] | null {
  const pieces = reactions.map((rxn) => solve([rxn], rxn, pourUnit, args))
  if (pieces.some((piece) => piece.volume > CAPACITY + EPS)) return null
  return pieces
}

function branchesOf(reactions: Rxn[], root: Rxn): Rxn[][] {
  const byProduct = new Map(reactions.map((rxn) => [rxn.productId, rxn]))
  const claimed = new Set<string>([root.productId])
  const branches: Rxn[][] = []
  for (const reactant of root.recipe.reactants) {
    if (reactant.catalyst || !byProduct.has(reactant.id) || claimed.has(reactant.id)) continue
    const branch: Rxn[] = []
    const stack = [reactant.id]
    while (stack.length) {
      const id = stack.pop()
      if (!id || claimed.has(id)) continue
      const rxn = byProduct.get(id)
      if (!rxn) continue
      claimed.add(id)
      branch.push(rxn)
      for (const inner of rxn.recipe.reactants) {
        if (!inner.catalyst) stack.push(inner.id)
      }
    }
    if (branch.length) branches.push(branch)
  }
  return branches
}

function directRoot(branch: Rxn[], parent: Rxn): Rxn {
  const ids = new Set(branch.map((rxn) => rxn.productId))
  const direct = parent.recipe.reactants.find((reactant) => !reactant.catalyst && ids.has(reactant.id))
  return branch.find((rxn) => rxn.productId === direct?.id) ?? branch[0]
}

function binMerge(pieces: Solved[], args: Args, chain: Rxn[]): Solved[] {
  const bins: Solved[] = []
  for (const piece of pieces) {
    let placed = false
    for (let i = 0; i < bins.length; i++) {
      const merged = mergeSolved(bins[i], piece, args, chain)
      if (!merged || merged.volume > CAPACITY + EPS) continue
      bins[i] = merged
      placed = true
      break
    }
    if (!placed) bins.push(piece)
  }
  return bins
}

function mergeSolved(left: Solved, right: Solved, args: Args, chain: Rxn[]): Solved | null {
  const reactions: Rxn[] = []
  const seen = new Set<string>()
  for (const rxn of [...left.reactions, ...right.reactions]) {
    if (seen.has(rxn.productId)) continue
    seen.add(rxn.productId)
    reactions.push(rxn)
  }
  const heat = heatOf(reactions.map((rxn) => rxn.recipe))
  if (!heat) return null
  const used = new Set<string>()
  for (const rxn of reactions) {
    for (const reactant of rxn.recipe.reactants) {
      if (!reactant.catalyst) used.add(reactant.id)
    }
  }
  const sinks = reactions.filter((rxn) => !used.has(rxn.productId))
  if (!sinks.length || finishedWithExtra(sinks, chain) || catalystProductShared(sinks)) return null
  const solved = solveRoots(reactions, sinks, left.pourUnit, args, sinkRuns(sinks, chain))
  const merged = { ...solved, root: left.root, minTemp: heat.min, maxTemp: heat.max }
  if (mixConflicts(merged, args)) return null
  return merged
}

function catalystProductShared(sinks: Rxn[]): boolean {
  if (sinks.length < 2) return false
  return sinks.some((sink) => sink.recipe.reactants.some((reactant) => reactant.catalyst))
}

function finishedWithExtra(sinks: Rxn[], chain: Rxn[]): boolean {
  const consumed = new Set<string>()
  for (const rxn of chain) {
    for (const reactant of rxn.recipe.reactants) {
      if (!reactant.catalyst) consumed.add(reactant.id)
    }
  }
  const finished = sinks.filter((sink) => !consumed.has(sink.productId))
  return finished.length > 0 && sinks.length > finished.length
}

function sinkRuns(sinks: Rxn[], chain: Rxn[]): Map<string, Rat> {
  const sinkIds = new Set(sinks.map((sink) => sink.productId))
  const producers = new Map(chain.map((rxn) => [rxn.productId, rxn]))
  const consumed = new Set<string>()
  for (const rxn of chain) {
    for (const reactant of rxn.recipe.reactants) {
      if (!reactant.catalyst) consumed.add(reactant.id)
    }
  }
  const need = new Map<string, Rat>()
  const visiting = new Set<string>()
  const requireAmt = (id: string, amount: Rat) => {
    const current = need.get(id)
    need.set(id, current ? add(current, amount) : amount)
    if (sinkIds.has(id) || visiting.has(id)) return
    const producer = producers.get(id)
    if (!producer) return
    visiting.add(id)
    const yieldAmt = fromNumber(productOf(producer.recipe, producer.productId).amount)
    const runs = div(amount, yieldAmt)
    for (const reactant of producer.recipe.reactants) {
      if (reactant.catalyst) continue
      requireAmt(reactant.id, mul(fromNumber(reactant.amount), runs))
    }
    visiting.delete(id)
  }
  for (const root of chain) {
    if (consumed.has(root.productId)) continue
    requireAmt(root.productId, fromNumber(productOf(root.recipe, root.productId).amount))
  }
  const runs = new Map<string, Rat>()
  for (const sink of sinks) {
    const demand = need.get(sink.productId)
    if (!demand) continue
    const yieldAmt = fromNumber(productOf(sink.recipe, sink.productId).amount)
    runs.set(sink.productId, div(demand, yieldAmt))
  }
  return runs
}

type Piece = { steps: PlumbingStep[]; fails: Fail[] }

function compileReagent(
  id: string,
  asTarget: boolean,
  choice: PlumbingChoice | undefined,
  args: Args,
  stack: Set<string>,
): Piece {
  if (stack.has(id) || forcedLeaf(id, args) || (!asTarget && args.targets.has(id))) return { steps: [], fails: [] }
  if (!asTarget && args.access.has(id)) return { steps: [], fails: [] }
  const recipe = recipeFor(id, asTarget, args)
  if (!recipe) return { steps: [], fails: [] }
  if (isMachine(recipe)) {
    const rxn = toRxn(recipe, id, args)
    const children = recipe.reactants
      .filter((reactant) => !reactant.catalyst)
      .map((reactant) => compileReagent(reactant.id, false, choice, args, stack))
    const solved = solve([rxn], rxn, 10, args)
    return {
      steps: [
        ...children.flatMap((child) => child.steps),
        mixStep(solved, solved.volume > CAPACITY + EPS, recipe.requiredMixerCategories[0]),
      ],
      fails: children.flatMap((child) => child.fails),
    }
  }

  const gathered = gather(id, asTarget, args, [], new Set())
  const inside = new Set(gathered.reactions.map((rxn) => rxn.productId))
  const detached = gathered.detached.filter((reagentId) => !inside.has(reagentId))
  stack.add(id)
  const children = detached
    .filter((reagentId) => !args.targets.has(reagentId) && recipeFor(reagentId, false, args) && !forcedLeaf(reagentId, args))
    .map((reagentId) => compileReagent(reagentId, false, choice, args, stack))
  stack.delete(id)
  const childSteps = children.flatMap((child) => child.steps)
  const childFails = children.flatMap((child) => child.fails)
  if (!gathered.reactions.length) return { steps: childSteps, fails: childFails }

  const solved = solve(gathered.reactions, gathered.root, 10, args)
  if (solved.volume <= CAPACITY + EPS && !mixConflicts(solved, args)) {
    return { steps: [...childSteps, mixStep(solved, false)], fails: childFails }
  }
  const fail = { reactions: gathered.reactions, root: gathered.root }
  if (!choice) return { steps: childSteps, fails: [...childFails, fail] }
  if (choice === 'steps' && canSplit(fail, args)) {
    const packed = packFits(fail.reactions, fail.root, args, 10, fail.reactions)
    const parts = packed ?? eachFits(fail.reactions, args, 10) ?? []
    return { steps: [...childSteps, ...parts.map((part) => mixStep(part, false))], fails: childFails }
  }
  const small = solve(fail.reactions, fail.root, 1, args)
  if (small.volume <= CAPACITY + EPS && !mixConflicts(small, args)) {
    return { steps: [...childSteps, mixStep(small, false)], fails: childFails }
  }
  const packedSmall = packFits(fail.reactions, fail.root, args, 1, fail.reactions)
  if (packedSmall) {
    return { steps: [...childSteps, ...packedSmall.map((part) => mixStep(part, false))], fails: childFails }
  }
  return {
    steps: [...childSteps, mixStep(small, true)],
    fails: childFails,
  }
}

function gather(
  id: string,
  asTarget: boolean,
  args: Args,
  window: Recipe[],
  seen: Set<string>,
): { reactions: Rxn[]; root: Rxn; detached: string[] } {
  const recipe = recipeFor(id, asTarget, args)
  const blank = { reactions: [] as Rxn[], root: { recipe: recipe as Recipe, productId: id, productName: id }, detached: [] as string[] }
  if (seen.has(id)) return blank
  if (!asTarget && (args.access.has(id) || args.targets.has(id))) return blank
  if (!recipe || isMachine(recipe) || forcedLeaf(id, args)) return { ...blank, detached: [id] }
  if (window.length && !joins(window, recipe)) return { ...blank, detached: [id] }
  seen.add(id)
  const root = toRxn(recipe, id, args)
  const reactions = [root]
  const detached: string[] = []
  const next = [...window, recipe]
  for (const reactant of recipe.reactants) {
    if (reactant.catalyst) continue
    if (reactions.some((rxn) => rxn.productId === reactant.id)) continue
    const sub = gather(reactant.id, false, args, next, seen)
    if (!sub.reactions.length) {
      detached.push(reactant.id)
      continue
    }
    for (const rxn of sub.reactions) {
      if (!reactions.some((have) => have.productId === rxn.productId)) reactions.push(rxn)
    }
    detached.push(...sub.detached)
  }
  return { reactions, root, detached }
}

function joins(window: Recipe[], recipe: Recipe): boolean {
  return heatOf([...window, recipe]) != null
}

function heatOf(recipes: Recipe[]): { min: number | null; max: number | null } | null {
  let min: number | null = null
  let max: number | null = null
  for (const recipe of recipes) {
    if (recipe.minTemp != null) min = min == null ? recipe.minTemp : Math.max(min, recipe.minTemp)
    if (recipe.maxTemp != null) max = max == null ? recipe.maxTemp : Math.min(max, recipe.maxTemp)
  }
  if (min != null && max != null && min > max + EPS) return null
  return { min, max }
}

type Solved = {
  root: Rxn
  reactions: Rxn[]
  products: { id: string; name: string; amount: number }[]
  pours: PlumbingPour[]
  productAmount: number
  minTemp: number | null
  maxTemp: number | null
  volume: number
  pourUnit: number
}

function mixConflicts(solved: Solved, args: Args): boolean {
  return hasSideReaction(solved, args) || catalystHogs(solved)
}

function catalystHogs(solved: Solved): boolean {
  if (solved.reactions.length < 2) return false
  const reserved = new Set<string>()
  for (const rxn of solved.reactions) {
    if (!rxn.recipe.reactants.some((reactant) => reactant.catalyst)) continue
    for (const reactant of rxn.recipe.reactants) {
      if (!reactant.catalyst) reserved.add(reactant.id)
    }
  }
  if (!reserved.size) return false
  const users = new Map<string, number>()
  for (const rxn of solved.reactions) {
    const seen = new Set<string>()
    for (const reactant of rxn.recipe.reactants) {
      if (reactant.catalyst || !reserved.has(reactant.id) || seen.has(reactant.id)) continue
      seen.add(reactant.id)
      users.set(reactant.id, (users.get(reactant.id) ?? 0) + 1)
    }
  }
  for (const count of users.values()) {
    if (count > 1) return true
  }
  return false
}

function hasSideReaction(solved: Solved, args: Args): boolean {
  if (solved.reactions.length < 2) return false
  const intended = new Set(solved.reactions.map((rxn) => rxn.recipe.id))
  const present = new Set<string>()
  for (const pour of solved.pours) present.add(pour.id)
  for (const rxn of solved.reactions) {
    for (const product of rxn.recipe.products) present.add(product.id)
  }
  for (const recipe of args.recipesByProduct.byId.values()) {
    if (intended.has(recipe.id) || recipe.requiredMixerCategories.length > 0 || !recipe.reactants.length) continue
    if (!tempAllows(solved, recipe) || consumedWithProduct(recipe, solved)) continue
    if (recipe.reactants.every((reactant) => present.has(reactant.id))) return true
  }
  return false
}

function consumedWithProduct(recipe: Recipe, solved: Solved): boolean {
  const needs = new Set(recipe.reactants.map((reactant) => reactant.id))
  for (const rxn of solved.reactions) {
    const makes = rxn.recipe.products.some((product) => needs.has(product.id))
    const eats = rxn.recipe.reactants.some((reactant) => !reactant.catalyst && needs.has(reactant.id))
    if (makes && eats) return true
  }
  return false
}

function tempAllows(solved: Solved, recipe: Recipe): boolean {
  if (solved.minTemp == null) {
    if (recipe.minTemp != null) return false
  } else if (recipe.minTemp != null && recipe.minTemp > solved.minTemp + EPS) return false
  if (solved.maxTemp != null && recipe.minTemp != null && recipe.minTemp > solved.maxTemp + EPS) return false
  if (recipe.maxTemp != null && solved.minTemp != null && solved.minTemp > recipe.maxTemp + EPS) return false
  return true
}

function solve(reactions: Rxn[], root: Rxn, pourUnit: number, args: Args): Solved {
  return solveRoots(reactions, [root], pourUnit, args)
}

function solveRoots(
  reactions: Rxn[],
  roots: Rxn[],
  pourUnit: number,
  args: Args,
  runsFor?: Map<string, Rat>,
): Solved {
  const producers = new Map(reactions.map((rxn) => [rxn.productId, rxn]))
  const leaves = new Map<string, { name: string; amount: Rat }>()
  const cats = new Map<string, { name: string; amount: number }>()
  const visiting = new Set<string>()
  const made = new Map<string, Rat>()

  const walk = (rxn: Rxn, runs: Rat) => {
    if (visiting.has(rxn.productId)) return
    visiting.add(rxn.productId)
    for (const reactant of rxn.recipe.reactants) {
      const need = mul(fromNumber(reactant.amount), runs)
      if (reactant.catalyst) {
        const current = cats.get(reactant.id)
        if (!current || reactant.amount > current.amount) {
          cats.set(reactant.id, { name: reagentName(reactant.id, reactant.name, args), amount: reactant.amount })
        }
        continue
      }
      const producer = producers.get(reactant.id)
      if (producer && producer.productId !== rxn.productId) {
        const produced = fromNumber(productOf(producer.recipe, producer.productId).amount)
        walk(producer, div(need, produced))
        continue
      }
      const existing = leaves.get(reactant.id)
      leaves.set(reactant.id, {
        name: reagentName(reactant.id, reactant.name, args),
        amount: existing ? add(existing.amount, need) : need,
      })
    }
    visiting.delete(rxn.productId)
  }

  for (const root of roots) {
    const runs = runsFor?.get(root.productId) ?? { n: 1n, d: 1n }
    walk(root, runs)
    const product = productOf(root.recipe, root.productId)
    const amount = mul(fromNumber(product.amount), runs)
    const current = made.get(root.productId)
    made.set(root.productId, current ? add(current, amount) : amount)
  }
  const scale = align(leaves, pourUnit)
  const pours: PlumbingPour[] = []
  let volume = 0
  for (const [id, leaf] of leaves) {
    const amount = scaleAmount(leaf.amount, scale)
    if (amount <= EPS) continue
    pours.push({ id, name: leaf.name, amount, catalyst: false })
    volume += amount
  }
  for (const [id, cat] of cats) {
    pours.push({ id, name: cat.name, amount: cat.amount, catalyst: true })
    volume += cat.amount
  }
  const products = roots.map((root) => ({
    id: root.productId,
    name: root.productName,
    amount: scaleAmount(made.get(root.productId) ?? { n: 0n, d: 1n }, scale),
  }))
  const heat = heatOf(reactions.map((rxn) => rxn.recipe)) ?? { min: null, max: null }
  return {
    root: roots[0],
    reactions,
    products,
    pours,
    productAmount: products[0]?.amount ?? 0,
    minTemp: heat.min,
    maxTemp: heat.max,
    volume,
    pourUnit,
  }
}

function fillHeat(solved: Solved): Solved {
  if (solved.minTemp == null || solved.volume > CAPACITY + EPS) return solved
  const catalyst = solved.pours.filter((pour) => pour.catalyst).reduce((sum, pour) => sum + pour.amount, 0)
  const rest = solved.volume - catalyst
  if (rest <= EPS) return solved
  const repeats = Math.floor((CAPACITY - catalyst + EPS) / rest)
  if (repeats <= 1) return solved
  return {
    ...solved,
    pours: solved.pours.map((pour) => (pour.catalyst ? pour : { ...pour, amount: pour.amount * repeats })),
    products: solved.products.map((product) => ({ ...product, amount: product.amount * repeats })),
    productAmount: solved.productAmount * repeats,
    volume: rest * repeats + catalyst,
  }
}

function mixStep(solved: Solved, overCapacity: boolean, mixer?: string): PlumbingStep {
  const filled = mixer ? solved : fillHeat(solved)
  const products = [...filled.products].sort((a, b) => a.name.localeCompare(b.name))
  return {
    kind: mixer ? 'machine' : 'mix',
    productId: products[0]?.id ?? filled.root.productId,
    productName: products.map((product) => product.name).join(', '),
    productAmount: products[0]?.amount ?? filled.productAmount,
    products,
    pours: filled.pours,
    minTemp: solved.minTemp,
    maxTemp: solved.maxTemp,
    mixer,
    overCapacity,
    pourUnit: solved.pourUnit,
  }
}

function align(leaves: Map<string, { amount: Rat }>, pourUnit: number): bigint {
  let clear = 1n
  for (const leaf of leaves.values()) {
    if (leaf.amount.n === 0n) continue
    const den = leaf.amount.d / gcd(abs(leaf.amount.n), leaf.amount.d)
    clear = lcm(clear, den)
  }
  let extra = 1n
  const pour = BigInt(pourUnit)
  for (const leaf of leaves.values()) {
    if (leaf.amount.n === 0n) continue
    const unit = (clear * leaf.amount.n) / leaf.amount.d
    const g = gcd(abs(unit), pour)
    extra = lcm(extra, pour / g)
  }
  const scale = clear * extra
  return scale > 0n ? scale : 1n
}

function scaleAmount(amount: Rat, scale: bigint): number {
  const num = scale * amount.n
  if (amount.d === 0n) return 0
  return Number(num / amount.d)
}

function attachGrinds(steps: PlumbingStep[], args: Args): PlumbingStep[] {
  const needs = new Map<string, { plant: GrindYield; amount: number }>()
  for (const step of steps) {
    for (const pour of step.pours) {
      if (pour.catalyst) continue
      const source = args.sources[pour.id]
      if (!source?.sourceId.startsWith('item:')) continue
      const plant = findPlant(source.sourceId, args.grinds)
      if (!plant) continue
      const output = plant.outputs.find((item) => item.id === pour.id)
      if (!output || output.amount <= EPS) continue
      const key = `${plant.method ?? 'grind'}:${plant.id}`
      const current = needs.get(key) ?? { plant, amount: 0 }
      current.amount += pour.amount * (step.times ?? 1)
      needs.set(key, current)
    }
  }
  const grinds: PlumbingStep[] = []
  for (const { plant, amount } of needs.values()) {
    const matched = [...plant.outputs].sort((a, b) => b.amount - a.amount)[0]
    const count = Math.max(1, Math.ceil((amount - EPS) / (matched?.amount || 1)))
    const made = plant.outputs.map((item) => `${item.name} ${formatUnits(item.amount * count)}`).join(', ')
    grinds.push({
      kind: 'grind',
      productId: plant.id,
      productName: plant.name,
      productAmount: (matched?.amount ?? 0) * count,
      pours: [],
      minTemp: null,
      maxTemp: null,
      grindText: `${plant.name} ${formatUnits(count)} → ${made}`,
      overCapacity: false,
      pourUnit: 10,
    })
  }
  return [...grinds, ...steps]
}

function findPlant(sourceId: string, grinds: GrindYield[]): GrindYield | undefined {
  const parts = sourceId.split(':')
  if (parts[0] !== 'item' || (parts[1] !== 'grind' && parts[1] !== 'juice') || !parts[2]) return undefined
  const plantId = parts.slice(2).join(':')
  return grinds.find((plant) => plant.id === plantId && (plant.method ?? 'grind') === parts[1])
}

function recipeFor(id: string, asTarget: boolean, args: Args): Recipe | undefined {
  const choice = args.sources[id]
  if (choice?.sourceId.startsWith('reaction:') || choice?.sourceId.startsWith('chain:')) {
    const recipeId = choice.sourceId.split(':').pop()
    const recipe = recipeId ? args.recipesByProduct.byId.get(recipeId) : undefined
    if (recipe) return recipe
  }
  if (forcedLeaf(id, args)) return undefined
  return pickRecipe(id, args.recipesByProduct, asTarget, args.machines)
}

function forcedLeaf(id: string, args: Args): boolean {
  const source = args.sources[id]?.sourceId
  if (!source) return false
  if (source.startsWith('reaction:') || source.startsWith('chain:')) return false
  return true
}

function isMachine(recipe: Recipe): boolean {
  const name = recipe.requiredMixerCategories[0]?.toLowerCase() ?? ''
  return name === 'centrifuge' || name === 'electrolysis'
}

function toRxn(recipe: Recipe, productId: string, args: Args): Rxn {
  const product = productOf(recipe, productId)
  return { recipe, productId, productName: reagentName(productId, product.name, args) }
}

function reagentName(id: string, fallback: string, args: Args): string {
  return args.names.get(id)?.name ?? fallback ?? id
}

function fromNumber(value: number): Rat {
  const n = BigInt(Math.round(value * 1000))
  return simplify(n, 1000n)
}

function simplify(n: bigint, d: bigint): Rat {
  if (d < 0n) {
    n = -n
    d = -d
  }
  if (d === 0n) return { n: 0n, d: 1n }
  const g = gcd(abs(n), d)
  return { n: n / g, d: d / g }
}

function mul(a: Rat, b: Rat): Rat {
  return simplify(a.n * b.n, a.d * b.d)
}

function add(a: Rat, b: Rat): Rat {
  return simplify(a.n * b.d + b.n * a.d, a.d * b.d)
}

function div(a: Rat, b: Rat): Rat {
  return simplify(a.n * b.d, a.d * b.n)
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n
}

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a)
  let y = abs(b)
  while (y !== 0n) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1n
}

function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n
  return (abs(a) / gcd(a, b)) * abs(b)
}

export function describePlumbingStep(step: PlumbingStep): string {
  if (step.kind === 'grind' && step.grindText) return step.grindText
  const pours = [...step.pours]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((pour) => `${pour.name} ${formatUnits(pour.amount)}${pour.catalyst ? ' catalyst' : ''}`)
  const heat = step.minTemp != null ? `${describeHeat(step.minTemp)}, ` : ''
  const cool = step.minTemp == null && step.maxTemp != null ? `COOL below ${formatUnits(step.maxTemp)}K, ` : ''
  const products = (step.products?.length
    ? step.products
    : [{ id: step.productId, name: step.productName, amount: step.productAmount }]
  )
    .map((product) => `${product.name} ${formatUnits(product.amount)}`)
    .join(', ')
  const times = timesWord(step.times ?? 1)
  const repeat = times ? `, ${times}` : ''
  return `${heat}${cool}${pours.join(', ')} → ${products}${repeat}`
}

export function formatPlumbing(title: string, guides: PlumbingGuide[], supplies: PlumbingSupplies): string {
  const lines = [title, '']
  const blocks: [string, PlumbingSupply[]][] = [
    ['Chem dispenser', supplies.dispenser],
    ['ChemVend', supplies.vend],
    ['Outside', supplies.outside],
  ]
  for (const [heading, items] of blocks) {
    if (!items.length) continue
    lines.push(heading)
    for (const item of items) lines.push(`${item.name} ${formatUnits(item.amount)}`)
    lines.push('')
  }
  for (const guide of guides) {
    if (guide.name) lines.push(guide.name)
    for (const step of guide.steps) {
      const tag = step.kind === 'grind' ? 'GRIND ' : step.mixer ? `${step.mixer.toUpperCase()} ` : ''
      lines.push(`${tag}${describePlumbingStep(step)}`)
      if (step.overCapacity) lines.push('Over 120u.')
      if (step.pourUnit === 1 && step.kind !== 'grind') lines.push('1u pours.')
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}
