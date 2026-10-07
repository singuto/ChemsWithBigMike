import type { Recipe } from './types'

const SHORT: Record<string, string> = {
  Bicaridine: 'BIC',
  Dermaline: 'DERM',
  Dylovene: 'DYLO',
  Arithrazine: 'ARITH',
  Amoxla: 'AMOX',
  Saline: 'SALINE',
  Dexalin: 'DEX',
  DexalinPlus: 'DEXP',
  Bruizine: 'BRUIZ',
  Lacerinol: 'LACE',
  Puncturase: 'PNCT',
  Leporazine: 'LEPO',
  Pyrazine: 'PYRA',
  Insuzine: 'INSU',
  Sigynate: 'SIGY',
  Siderlac: 'SIDER',
  Oculine: 'OCUL',
  Cryoxadone: 'CRYOX',
  Doxarubixadone: 'DOXA',
  Arcryox: 'ARCRYO',
  UnstableMutagen: 'MUTA',
  Phalanximine: 'PHAL',
  Diethylamine: 'DIETH',
  Left4Zed: 'L4Z',
  RobustHarvest: 'ROBUST',
  Diphenhydramine: 'DIPH',
  Charcoal: 'CHARCOAL',
  Necrosol: 'NECRO',
  Chronexaline: 'CHRON',
  Tricordrazine: 'TRIC',
  Epinephrine: 'EPI',
  Ethylredoxrazine: 'ETHYL',
  Haloperidol: 'HALOPER',
  TranexamicAcid: 'TRANX',
  Ambuzol: 'AMBUZ',
  Inaprovaline: 'INAP',
  Ammonia: 'NH3',
  TableSalt: 'SALT',
  Kelotane: 'KELO',
  Hydroxide: 'OH',
  SodiumHydroxide: 'NaOH',
  SodiumCarbonate: 'Na2CO3',
  Fersilicite: 'FERSI',
  SulfuricAcid: 'H2SO4',
  Benzene: 'BENZ',
  Acetone: 'ACE',
  Phenol: 'PHEN',
  WeldingFuel: 'FUEL',
}

export function shortName(id: string, name?: string): string {
  if (SHORT[id]) return SHORT[id]
  const base = (name ?? id).replace(/[^A-Za-z0-9]/g, '')
  return base.slice(0, 6).toUpperCase()
}

export function formatUnits(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const rounded = Math.round(n * 100) / 100
  if (Math.abs(rounded - Math.round(rounded)) < 0.049) return String(Math.round(rounded))
  return rounded.toFixed(1)
}

export function timesWord(n: number): string {
  if (n <= 1) return ''
  if (n === 2) return 'Twice'
  if (n === 3) return 'Thrice'
  return `${n} Times`
}

export function recipeScore(recipe: Recipe): number {
  const file = recipe.sourceFile.toLowerCase()
  let score = 0
  if (file.includes('medicine.yml')) score += 100
  else if (file.includes('chemicals.yml')) score += 80
  else if (file.includes('botany') || file.includes('pyrotechnic')) score += 60
  else if (file.includes('drinks')) score -= 50
  if (recipe.requiredMixerCategories.length === 0) score += 20
  score -= recipe.reactants.length
  return score
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}
