import type { Equipment } from '../types'

const PRESETS = [120, 180, 240]

type Props = {
  equipment: Equipment
  onChange: (next: Equipment) => void
  canGenerate: boolean
  onGenerate: () => void
  onPlumbing: () => void
  onReset: () => void
  useSavedDefaults: boolean
  onUseSavedDefaults: (value: boolean) => void
  editing: boolean
  onEditing: (value: boolean) => void
}

export function SetupBar({
  equipment,
  onChange,
  canGenerate,
  onGenerate,
  onPlumbing,
  onReset,
  useSavedDefaults,
  onUseSavedDefaults,
  editing,
  onEditing,
}: Props) {
  const custom = !PRESETS.includes(equipment.capacity)
  const desktop = Boolean(window.kobold?.minimize)

  return (
    <header
      className={desktop ? 'setup desktop' : 'setup'}
      onDoubleClick={(event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest('button, input, label, select, textarea, fieldset')) return
        window.kobold?.toggleMaximize()
      }}
    >
      <div className="titlebar">
        <div className="brand">
          <strong>Chems with Big Mike</strong>
          <span>· Starlight</span>
        </div>
      </div>
      <div className="setup-tools">
      <div className="setup-groups">
      <fieldset className="capacity">
        <legend>Beaker</legend>
        {PRESETS.map((n) => (
          <label key={n}>
            <input
              type="radio"
              name="capacity"
              checked={equipment.capacity === n}
              onChange={() => onChange({ ...equipment, capacity: n })}
            />
            {n}u
          </label>
        ))}
        <label className="custom-cap">
          <input
            type="radio"
            name="capacity"
            checked={custom}
            onChange={() => onChange({ ...equipment, capacity: equipment.capacity || 120 })}
          />
          Custom
          <input
            type="number"
            min={1}
            value={equipment.capacity}
            onChange={(e) =>
              onChange({ ...equipment, capacity: Math.max(1, Number(e.target.value) || 1) })
            }
          />
          u
        </label>
      </fieldset>
      <fieldset className="equip">
        <legend>Machines available</legend>
        <label>
          <input
            type="checkbox"
            checked={equipment.dispenser}
            onChange={(e) => onChange({ ...equipment, dispenser: e.target.checked })}
          />
          Chem dispenser
        </label>
        <label>
          <input
            type="checkbox"
            checked={equipment.chemVend}
            onChange={(e) => onChange({ ...equipment, chemVend: e.target.checked })}
          />
          ChemVend
        </label>
        <label>
          <input
            type="checkbox"
            checked={equipment.grinder}
            onChange={(e) => onChange({ ...equipment, grinder: e.target.checked })}
          />
          Grinder
        </label>
        <label>
          <input
            type="checkbox"
            checked={equipment.centrifuge}
            onChange={(e) => onChange({ ...equipment, centrifuge: e.target.checked })}
          />
          Centrifuge
        </label>
        <label>
          <input
            type="checkbox"
            checked={equipment.electrolysis}
            onChange={(e) => onChange({ ...equipment, electrolysis: e.target.checked })}
          />
          Electrolysis
        </label>
        <label>
          <input
            type="checkbox"
            checked={equipment.unit === 1}
            onChange={(e) => onChange({ ...equipment, unit: e.target.checked ? 1 : 5 })}
          />
          ChemMaster
        </label>
      </fieldset>
      </div>
      <div className="setup-actions">
        <div className="setup-buttons">
        <button type="button" className="primary" disabled={!canGenerate} onClick={onGenerate}>
          Generate
        </button>
        <button type="button" className="primary" disabled={!canGenerate} onClick={onPlumbing}>
          Generate plumbing
        </button>
        <button type="button" className="ghost" onClick={onReset}>
          Reset to defaults
        </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={useSavedDefaults}
            onChange={(e) => onUseSavedDefaults(e.target.checked)}
          />
          Use saved source defaults
        </label>
        <label className="edit-toggle">
          <input type="checkbox" checked={editing} onChange={(e) => onEditing(e.target.checked)} />
          Edit
        </label>
      </div>
      </div>
      {desktop && (
        <div className="window-controls">
          <button type="button" aria-label="Minimize" onClick={() => window.kobold?.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button type="button" aria-label="Maximize" onClick={() => window.kobold?.toggleMaximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button type="button" className="close" aria-label="Close" onClick={() => window.kobold?.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      )}
    </header>
  )
}
