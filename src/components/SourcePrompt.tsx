import { useState } from 'react'
import { formatUnits } from '../format'
import { optionsFor } from '../data'
import type { BaseSourcesFile, SourceChoice, SourceOption, UnresolvedBase } from '../types'

type Draft = Record<string, SourceChoice & { makeDefault: boolean }>

type Props = {
  missing: UnresolvedBase[]
  catalog: BaseSourcesFile
  onConfirm: (choices: Record<string, SourceChoice>, makeDefault: Record<string, boolean>) => void
}

function cardOptions(chem: UnresolvedBase, catalog: BaseSourcesFile): SourceOption[] {
  if (!chem.placeOptions?.length) return optionsFor(chem.id, catalog)
  const seen = new Set(chem.placeOptions.map((option) => option.id))
  return [...chem.placeOptions, ...catalog.always.filter((option) => !seen.has(option.id))]
}

export function SourcePrompt({ missing, catalog, onConfirm }: Props) {
  const [draft, setDraft] = useState<Draft>({})

  function set(id: string, patch: Partial<Draft[string]>) {
    setDraft((prev) => ({
      ...prev,
      [id]: {
        sourceId: prev[id]?.sourceId ?? '',
        note: prev[id]?.note,
        makeDefault: prev[id]?.makeDefault ?? false,
        ...patch,
      },
    }))
  }

  const ready = missing.every((m) => draft[m.id]?.sourceId)

  return (
    <section className="sources">
      <h2>How will you get these?</h2>
      <p className="note">
        These base chems are not on your dispenser or ChemVend. Choose what to make each one from, or
        bring the chem yourself. Check “make default” to remember the answer next time.
      </p>
      <ul className="source-cards">
        {missing.map((chem) => {
          const opts = cardOptions(chem, catalog)
          const current = draft[chem.id]
          const needed =
            chem.measure === 'count'
              ? `${formatUnits(chem.amount)} needed`
              : `${formatUnits(chem.amount)}u needed`
          return (
            <li key={chem.id}>
              <header>
                <strong>{chem.name}</strong>
                <span>{needed}</span>
              </header>
              {!chem.methods?.length && chem.yieldInfo && (
                <p className="yield">
                  <span>{chem.yieldInfo.line}</span>
                  <span>{chem.yieldInfo.detail}</span>
                </p>
              )}
              <select
                className="method-select"
                value={current?.sourceId ?? ''}
                onChange={(e) => set(chem.id, { sourceId: e.target.value })}
              >
                <option value="">Choose…</option>
                {chem.methods && chem.methods.length > 0 && (
                  <optgroup label="Make it from">
                    {chem.methods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Bring the chem">
                  {opts.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              {(current?.sourceId === 'custom' || current?.sourceId === 'have') && (
                <input
                  placeholder="Optional note"
                  value={current.note ?? ''}
                  onChange={(e) => set(chem.id, { note: e.target.value })}
                />
              )}
              <label className="default">
                <input
                  type="checkbox"
                  checked={Boolean(current?.makeDefault)}
                  onChange={(e) => set(chem.id, { makeDefault: e.target.checked })}
                />
                Make default for future use
              </label>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="primary"
        disabled={!ready}
        onClick={() => {
          const choices: Record<string, SourceChoice> = {}
          const makeDefault: Record<string, boolean> = {}
          for (const chem of missing) {
            const d = draft[chem.id]
            if (!d?.sourceId) continue
            choices[chem.id] = { sourceId: d.sourceId, note: d.note }
            makeDefault[chem.id] = d.makeDefault
          }
          onConfirm(choices, makeDefault)
        }}
      >
        Continue
      </button>
    </section>
  )
}
