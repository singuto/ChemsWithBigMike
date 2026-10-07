import { useEffect, useMemo, useRef, useState } from 'react'
import { CategoryEditor } from './components/CategoryEditor'
import { CategoryList } from './components/CategoryList'
import { PlumbingPrompt } from './components/PlumbingPrompt'
import { PlumbingView } from './components/PlumbingView'
import { RecipeView } from './components/RecipeView'
import { SetupBar } from './components/SetupBar'
import { SourcePrompt } from './components/SourcePrompt'
import { loadAppData, sourceLabel, type AppData } from './data'
import { accessibleReagents, dispenserReagents, vendReagents } from './engine/access'
import { indexRecipes } from './engine/graph'
import { buildPlumbing, type PlumbingChoice, type PlumbingResult } from './engine/plumbing'
import { buildPlan } from './engine/plan'
import { newId } from './format'
import { cloneCategory, defaultEquipment, loadPersisted, persistSave } from './storage'
import { itemIncluded, type Category, type Equipment, type RecipePlan, type SourceChoice } from './types'

type Mode = 'exact' | 'plumbing'

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [equipment, setEquipment] = useState<Equipment>(defaultEquipment)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [savedSources, setSavedSources] = useState<Record<string, SourceChoice>>({})
  const [useSavedDefaults, setUseSavedDefaults] = useState(true)
  const [plan, setPlan] = useState<RecipePlan | null>(null)
  const [plumbing, setPlumbing] = useState<PlumbingResult | null>(null)
  const [mode, setMode] = useState<Mode>('exact')
  const [plumbingChoices, setPlumbingChoices] = useState<Record<string, PlumbingChoice>>({})
  const [editing, setEditing] = useState(true)
  const [awaitingSources, setAwaitingSources] = useState(false)
  const latest = useRef({
    equipment,
    categories,
    sources: savedSources,
    useSavedDefaults,
    selectedId,
  })
  latest.current = {
    equipment,
    categories,
    sources: savedSources,
    useSavedDefaults,
    selectedId,
  }

  useEffect(() => {
    let cancel = false
    Promise.all([loadAppData(), loadPersisted()])
      .then(([loaded, save]) => {
        if (cancel) return
        const cats = save.categories?.length
          ? save.categories.map(cloneCategory)
          : loaded.seedCategories.map(cloneCategory)
        setData(loaded)
        setEquipment(save.equipment)
        setCategories(cats)
        setSelectedId(cats.some((c) => c.id === save.selectedId) ? save.selectedId : (cats[0]?.id ?? ''))
        setSavedSources(save.sources)
        setUseSavedDefaults(save.useSavedDefaults)
        setHydrated(true)
      })
      .catch((err: unknown) => {
        if (cancel) return
        setError(err instanceof Error ? err.message : 'Failed to load data')
      })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated || !latest.current.categories.length) return
    persistSave(latest.current)
  }, [hydrated, equipment, categories, savedSources, useSavedDefaults, selectedId])

  useEffect(() => {
    const flush = () => {
      if (!latest.current.categories.length) return
      persistSave(latest.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  const recipesByProduct = useMemo(
    () =>
      data
        ? indexRecipes(data.recipes)
        : {
            lab: new Map(),
            any: new Map(),
            centrifuge: new Map(),
            electrolysis: new Map(),
            explosions: [],
            producers: new Map(),
            byId: new Map(),
          },
    [data],
  )
  const selected = categories.find((c) => c.id === selectedId) ?? categories[0]
  const sources = useMemo(
    () => (useSavedDefaults ? savedSources : {}),
    [useSavedDefaults, savedSources],
  )

  function generate(
    nextSources = sources,
    nextMode: Mode = mode,
    choices: Record<string, PlumbingChoice> = plumbingChoices,
  ) {
    if (!data || !selected) return
    const access = accessibleReagents(data.starting, equipment)
    const labels: Record<string, string> = {}
    for (const [id, choice] of Object.entries(nextSources)) {
      const plant = id.startsWith('plant:')
        ? data.grinds.find((grind) => `plant:${grind.id}` === id)
        : undefined
      labels[id] =
        sourceLabel(
          id,
          choice,
          data.sources,
          plant ? [{ id: plant.sourceId, label: plant.sourceLabel }] : [],
        ) ?? choice.sourceId
    }
    setMode(nextMode)
    if (nextMode === 'plumbing') {
      setPlumbingChoices(choices)
      const result = buildPlumbing({
        category: selected,
        recipesByProduct,
        access,
        dispenser: dispenserReagents(data.starting, equipment),
        vend: vendReagents(data.starting, equipment),
        sources: nextSources,
        names: data.reagents,
        machines: {
          centrifuge: equipment.centrifuge,
          electrolysis: equipment.electrolysis,
        },
        grinds: data.grinds,
        choices,
      })
      setPlumbing(result)
      setPlan(null)
      setAwaitingSources(result.unresolved.length > 0)
      return
    }
    const next = buildPlan({
      category: selected,
      recipesByProduct,
      access,
      dispenser: dispenserReagents(data.starting, equipment),
      vend: vendReagents(data.starting, equipment),
      sources: nextSources,
      sourceLabels: labels,
      names: data.reagents,
      capacity: equipment.capacity,
      unit: equipment.unit,
      machines: {
        grinder: equipment.grinder,
        centrifuge: equipment.centrifuge,
        electrolysis: equipment.electrolysis,
      },
      grinds: data.grinds,
      mass: false,
    })
    setPlumbing(null)
    setPlan(next)
    setAwaitingSources(next.unresolved.length > 0)
  }

  function confirmSources(
    choices: Record<string, SourceChoice>,
    makeDefault: Record<string, boolean>,
  ) {
    const persisted = { ...savedSources }
    for (const [id, choice] of Object.entries(choices)) {
      if (makeDefault[id]) persisted[id] = choice
    }
    setSavedSources(persisted)
    const snapshot = {
      equipment,
      categories,
      sources: persisted,
      useSavedDefaults,
      selectedId,
    }
    latest.current = snapshot
    persistSave(snapshot)
    generate({ ...(useSavedDefaults ? persisted : {}), ...choices })
  }

  function updateSelected(next: Category) {
    setCategories((cats) => cats.map((c) => (c.id === next.id ? next : c)))
    setPlan(null)
    setPlumbing(null)
    setAwaitingSources(false)
  }

  function addCategory() {
    const cat: Category = {
      id: newId('cat'),
      name: 'New category',
      items: [],
    }
    setCategories((cats) => [...cats, cat])
    setSelectedId(cat.id)
    setPlan(null)
    setPlumbing(null)
  }

  function deleteCategory(id: string) {
    setCategories((cats) => {
      const next = cats.filter((c) => c.id !== id)
      if (selectedId === id) setSelectedId(next[0]?.id ?? '')
      return next
    })
    setPlan(null)
    setPlumbing(null)
  }

  function resetDefaults() {
    if (!data) return
    const seed = data.seedCategories.map(cloneCategory)
    setCategories(seed)
    setSelectedId(seed[0]?.id ?? '')
    setPlan(null)
    setPlumbing(null)
    setAwaitingSources(false)
  }

  if (error) return <p className="boot-error">{error}</p>
  if (!hydrated || !data || !selected) return <p className="boot">Loading chemistry data…</p>

  const canGenerate = selected.items.some((i) => i.amount > 0 && itemIncluded(i))

  return (
    <div className="app">
      <SetupBar
        equipment={equipment}
        onChange={(next) => {
          setEquipment(next)
          setPlan(null)
          setPlumbing(null)
          setAwaitingSources(false)
        }}
        canGenerate={canGenerate}
        editing={editing}
        onEditing={setEditing}
        onGenerate={() => generate(sources, 'exact')}
        onPlumbing={() => generate(sources, 'plumbing', {})}
        onReset={resetDefaults}
        useSavedDefaults={useSavedDefaults}
        onUseSavedDefaults={(value) => {
          setUseSavedDefaults(value)
          setPlan(null)
          setPlumbing(null)
          setAwaitingSources(false)
          const snapshot = {
            equipment,
            categories,
            sources: savedSources,
            useSavedDefaults: value,
            selectedId,
          }
          latest.current = snapshot
          persistSave(snapshot)
        }}
      />
      <main className="layout">
        <CategoryList
          categories={categories}
          selectedId={selected.id}
          onSelect={(id) => {
            setSelectedId(id)
            setPlan(null)
            setPlumbing(null)
            setAwaitingSources(false)
          }}
          onAdd={addCategory}
          onRename={(id, name) =>
            setCategories((cats) => cats.map((c) => (c.id === id ? { ...c, name } : c)))
          }
          onDelete={deleteCategory}
          onReorder={(next) => setCategories(next)}
          editing={editing}
        />
        <CategoryEditor
          key={selected.id}
          category={selected}
          reagents={data.reagents}
          onChange={updateSelected}
          editing={editing}
        />
        <div className="output">
          {!equipment.dispenser && !equipment.chemVend && (
            <p className="hint">
              No dispenser or ChemVend selected — every base chem will ask for a source.
            </p>
          )}
          {awaitingSources && (plumbing?.unresolved.length || plan) && (
            <SourcePrompt
              missing={plumbing?.unresolved.length ? plumbing.unresolved : (plan?.unresolved ?? [])}
              catalog={data.sources}
              onConfirm={confirmSources}
            />
          )}
          {plumbing && !awaitingSources && plumbing.pending.length > 0 && (
            <PlumbingPrompt
              pending={plumbing.pending}
              onConfirm={(choices) => generate(sources, 'plumbing', { ...plumbingChoices, ...choices })}
            />
          )}
          {plumbing && !awaitingSources && plumbing.pending.length === 0 && (
            <PlumbingView title={selected.name} guides={plumbing.guides} supplies={plumbing.supplies} />
          )}
          {!plumbing && plan && !awaitingSources && (
            <RecipeView plan={plan} chemMaster={equipment.unit === 1} title={selected.name} />
          )}
          {!plan && !plumbing && (
            <p className="hint">Set your equipment, pick a category, then Generate.</p>
          )}
        </div>
      </main>
    </div>
  )
}
