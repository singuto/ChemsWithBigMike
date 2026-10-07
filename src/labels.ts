export type DrugLabel = {
  id: string
  mark: string
  text: string
  color: string
  categoryId?: string
}

const LABELS: DrugLabel[] = [
  { id: 'Bicaridine', mark: ':', text: 'BIC|BRT|15/5u|15OD+MixBRT', color: '#ffaa00' },
  { id: 'Dermaline', mark: '.', text: 'DERM|BRNnoCaus|15/5u|10OD', color: '#216b85' },
  { id: 'Dylovene', mark: '`', text: 'DYLO|Poison|10/5u|20OD', color: '#5b4695' },
  { id: 'Dylovene', mark: '~', text: 'DYLO|Remove Toxin', color: '#5b4695', categoryId: 'botany' },
  { id: 'Arithrazine', mark: '`', text: 'ARITH|Rads|30/5u|+BRTDmg', color: '#bd5902' },
  { id: 'Amoxla', mark: ',', text: 'AMOX|AmniaAIR|30/5u|25OD', color: '#89f77f' },
  { id: 'Saline', mark: ',', text: 'SALINE|Bloodlevel|15%/5u', color: '#0064c8' },
  { id: 'DexalinPlus', mark: ',', text: 'DEXP|Asphx+Bldls|35/5u|25OD', color: '#519fbb' },
  { id: 'Bruizine', mark: ':', text: 'BRUIZ|Blunt|45/5u|10OD+BRT', color: '#ff3636' },
  { id: 'Lacerinol', mark: ':', text: 'LACE|Slash|40/5u|12OD+BRT', color: '#788282' },
  { id: 'Puncturase', mark: ':', text: 'PNCT|Pierce|50/5u|11OD+BRT', color: '#b9bf93' },
  { id: 'Leporazine', mark: '.', text: 'LEPO|Cold|40/5u|<20kgOD', color: '#ff7db5' },
  { id: 'Pyrazine', mark: '.', text: 'PYRA|Heat|50/5u|15OD', color: '#964e24' },
  { id: 'Insuzine', mark: '.', text: 'INSU|Shock|30/5u|12OD+<20kg', color: '#9668fc' },
  { id: 'Sigynate', mark: '.', text: 'SIGY|Caustic|25/5u|16OD', color: '#e0a5b9' },
  { id: 'Siderlac', mark: '.', text: 'SIDER|Caustic|50/5u', color: '#f4dab8' },
  { id: 'Oculine', mark: '~', text: 'OCULINE|Eyesight|Use5u', color: '#999999' },
  { id: 'Cryoxadone', mark: '^', text: 'CRYOX|ALLnoCELL|<213K|ALIVE', color: '#0091ff' },
  { id: 'Cryoxadone', mark: '~', text: 'CRYOX|Reduce Plant Age/1u', color: '#0091ff', categoryId: 'botany' },
  { id: 'Doxarubixadone', mark: '^', text: 'DOXA|CELL|5/1u|<213K|ALIVE', color: '#32cd32' },
  { id: 'Arcryox', mark: '^', text: 'ARCR|BRT+BRN|>200dmg|DEAD', color: '#86caf7' },
  { id: 'UnstableMutagen', mark: '~', text: 'MUTA|mutates per 1u', color: '#00ff00' },
  { id: 'Phalanximine', mark: '~', text: 'PHAL|Remove Unviable/5u', color: '#c8ff75' },
  { id: 'Diethylamine', mark: '~', text: 'DIETH|Speed Plant Growth', color: '#85200c' },
  { id: 'Left4Zed', mark: '~', text: 'L4Z|preps4muta per plant', color: '#674ea7' },
  { id: 'RobustHarvest', mark: '~', text: 'ROBUST|3 potency/1u', color: '#38761d' },
  { id: 'Diphenhydramine', mark: '`', text: 'DIPH|Poison|30/5u', color: '#64ffe6' },
  { id: 'Charcoal', mark: '`', text: 'CHARCOAL|CleanBld|Use5u', color: '#4f5457' },
  { id: 'Necrosol', mark: '^', text: 'NECR|ALLnoRAD|5/1u|DEAD', color: '#86a5bd' },
  { id: 'Chronexaline', mark: '^', text: 'CHRON|RAD|10/1u|<213K|DEAD', color: '#850063' },
  { id: 'Tricordrazine', mark: ';', text: 'TRIC|ALL|10/5u', color: '#00e5ff' },
  { id: 'Epinephrine', mark: ',', text: 'EPI|ALL|15/5u|20OD|CritOnly', color: '#efefef' },
  { id: 'Ethylredoxrazine', mark: '~', text: 'ETHYL|Dizzy+Drunk|60s/5u', color: '#2d5708' },
  { id: 'Haloperidol', mark: '~', text: 'HALOPER|Stims|+Sleep', color: '#27870a' },
  { id: 'TranexamicAcid', mark: ',', text: 'TRANX|Stop Bleed|Use5u', color: '#ba7d7d' },
  { id: 'Ambuzol', mark: ',', text: 'AMBUZ|cure/10u|UseSyringe', color: '#86caf7' },
]

export function labelFor(categoryId: string, reagentId: string): DrugLabel | undefined {
  return (
    LABELS.find((label) => label.id === reagentId && label.categoryId === categoryId) ??
    LABELS.find((label) => label.id === reagentId && !label.categoryId)
  )
}

export function formatDrugLabel(label: { mark: string; text: string; color: string }): string {
  return `${label.mark}[color=${label.color}]${label.text}[/color]`
}
