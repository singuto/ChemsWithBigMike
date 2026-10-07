import { recipeScore } from '../format'
import type { Recipe } from '../types'

const SKIPPED_FILES = ['/drinks.yml', '/food.yml', '/biological.yml']

function allowedFile(recipe: Recipe): boolean {
  const file = recipe.sourceFile.replaceAll('\\', '/').toLowerCase()
  return !SKIPPED_FILES.some((part) => file.includes(part))
}

export function isChemLabRecipe(recipe: Recipe): boolean {
  return allowedFile(recipe) && recipe.requiredMixerCategories.length === 0
}

function indexFiltered(recipes: Recipe[], allow: (recipe: Recipe) => boolean): Map<string, Recipe> {
  const byProduct = new Map<string, Recipe[]>()
  for (const recipe of recipes) {
    if (!allow(recipe)) continue
    for (const product of recipe.products) {
      const list = byProduct.get(product.id) ?? []
      list.push(recipe)
      byProduct.set(product.id, list)
    }
  }
  const best = new Map<string, Recipe>()
  for (const [id, list] of byProduct) {
    list.sort((a, b) => recipeScore(b) - recipeScore(a))
    best.set(id, list[0])
  }
  return best
}

export function isHeatExplosion(recipe: Recipe): boolean {
  return (
    recipe.minTemp != null &&
    (recipe.reactionEffects ?? []).some((effect) => effect.type === 'Explosion')
  )
}

function indexProducers(recipes: Recipe[]): Map<string, Recipe[]> {
  const byProduct = new Map<string, Recipe[]>()
  for (const recipe of recipes) {
    if (recipe.requiredMixerCategories.length === 0) continue
    for (const product of recipe.products) {
      const list = byProduct.get(product.id) ?? []
      list.push(recipe)
      byProduct.set(product.id, list)
    }
  }
  return byProduct
}

export type RecipeIndex = {
  lab: Map<string, Recipe>
  centrifuge: Map<string, Recipe>
  electrolysis: Map<string, Recipe>
  any: Map<string, Recipe>
  explosions: Recipe[]
  producers: Map<string, Recipe[]>
  byId: Map<string, Recipe>
}

export function indexRecipes(recipes: Recipe[]): RecipeIndex {
  const oneMixer = (name: string) => (recipe: Recipe) =>
    allowedFile(recipe) &&
    recipe.requiredMixerCategories.length === 1 &&
    recipe.requiredMixerCategories[0] === name
  return {
    lab: indexFiltered(recipes, isChemLabRecipe),
    centrifuge: indexFiltered(recipes, oneMixer('Centrifuge')),
    electrolysis: indexFiltered(recipes, oneMixer('Electrolysis')),
    any: indexFiltered(recipes, (recipe) => recipe.requiredMixerCategories.length === 0),
    explosions: recipes.filter(isHeatExplosion),
    producers: indexProducers(recipes),
    byId: new Map(recipes.map((recipe) => [recipe.id, recipe])),
  }
}

export type MachineFlags = {
  centrifuge: boolean
  electrolysis: boolean
}

export function pickRecipe(
  id: string,
  indexes: RecipeIndex,
  asTarget: boolean,
  machines: MachineFlags,
): Recipe | undefined {
  return (
    indexes.lab.get(id) ??
    (machines.centrifuge ? indexes.centrifuge.get(id) : undefined) ??
    (machines.electrolysis ? indexes.electrolysis.get(id) : undefined) ??
    (asTarget ? indexes.any.get(id) : undefined)
  )
}

export function productOf(recipe: Recipe, productId: string) {
  return recipe.products.find((p) => p.id === productId) ?? recipe.products[0]
}
