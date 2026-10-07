import type {
  BaseSourcesFile,
  ChemRecipesFile,
  DefaultCategoriesFile,
  GrindFile,
  GrindYield,
  Recipe,
  ReagentInfo,
  SourceOption,
  StartingChemsFile,
} from './types'

export type AppData = {
  recipes: Recipe[]
  starting: StartingChemsFile
  sources: BaseSourcesFile
  seedCategories: DefaultCategoriesFile['categories']
  reagents: Map<string, ReagentInfo>
  grinds: GrindYield[]
}

function dataUrl(name: string): string {
  return `${import.meta.env.BASE_URL}${name}`
}

export async function loadAppData(): Promise<AppData> {
  const [recipesFile, starting, sources, defaults, grinds, itemYields] = await Promise.all([
    fetch(dataUrl('chem_recipes.json')).then((r) => r.json()) as Promise<ChemRecipesFile>,
    fetch(dataUrl('starting_chems.json')).then((r) => r.json()) as Promise<StartingChemsFile>,
    fetch(dataUrl('base_sources.json')).then((r) => r.json()) as Promise<BaseSourcesFile>,
    fetch(dataUrl('default_categories.json')).then((r) => r.json()) as Promise<DefaultCategoriesFile>,
    fetch(dataUrl('grind_yields.json')).then((r) => r.json()) as Promise<GrindFile>,
    fetch(dataUrl('item_yields.json')).then((r) => r.json()) as Promise<GrindFile>,
  ])

  const reagents = new Map<string, ReagentInfo>()
  const add = (id: string, name: string, color?: string, group?: string | null) => {
    const existing = reagents.get(id)
    if (!existing) {
      reagents.set(id, { id, name, color, group })
      return
    }
    if (!existing.color && color) existing.color = color
    if (!existing.group && group) existing.group = group
    if (name && name !== id) existing.name = name
  }

  for (const recipe of recipesFile.recipes) {
    for (const reactant of recipe.reactants) add(reactant.id, reactant.name)
    for (const product of recipe.products) {
      add(product.id, product.name, product.color, product.group)
    }
  }
  for (const jug of starting.dispenser.loadedJugs) {
    if (jug.id && jug.name) add(jug.id, jug.name)
  }
  for (const gen of starting.dispenser.generatable) add(gen.id, gen.name)
  for (const item of starting.chemVend.startingInventory) {
    if (item.id && item.name) add(item.id, item.name)
  }

  return {
    recipes: recipesFile.recipes,
    starting,
    sources,
    seedCategories: defaults.categories,
    reagents,
    grinds: [...grinds.yields, ...itemYields.yields],
  }
}

export function optionsFor(
  reagentId: string,
  catalog: BaseSourcesFile,
): { id: string; label: string }[] {
  const specific = catalog.reagents[reagentId] ?? []
  return [...specific, ...catalog.always]
}

export function sourceLabel(
  reagentId: string,
  choice: { sourceId: string; note?: string } | undefined,
  catalog: BaseSourcesFile,
  extras: SourceOption[] = [],
): string | undefined {
  if (!choice) return undefined
  const opt = [...extras, ...optionsFor(reagentId, catalog)].find((o) => o.id === choice.sourceId)
  const label = opt?.label ?? choice.sourceId
  if (choice.note) return `${label} — ${choice.note}`
  return label
}
