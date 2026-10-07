import { useState } from 'react'
import type { PlumbingChoice, PlumbingPending } from '../engine/plumbing'

type Props = {
  pending: PlumbingPending[]
  onConfirm: (choices: Record<string, PlumbingChoice>) => void
}

export function PlumbingPrompt({ pending, onConfirm }: Props) {
  const [draft, setDraft] = useState<Record<string, PlumbingChoice>>({})
  const ready = pending.every((item) => draft[item.id])

  return (
    <section className="sources">
      <h2>This mix does not fit</h2>
      <p className="note">
        A 10u pour does not fit in one 120u mix. Split it into steps, or lower that mix to 1u pours.
      </p>
      <ul className="source-cards">
        {pending.map((item) => (
          <li key={item.id}>
            <header>
              <strong>{item.name}</strong>
            </header>
            <div className="setup-actions">
              {item.canSplit && (
                <button
                  type="button"
                  className={draft[item.id] === 'steps' ? 'primary' : ''}
                  onClick={() => setDraft((current) => ({ ...current, [item.id]: 'steps' }))}
                >
                  Multiple steps
                </button>
              )}
              <button
                type="button"
                className={draft[item.id] === 'pour1' ? 'primary' : ''}
                onClick={() => setDraft((current) => ({ ...current, [item.id]: 'pour1' }))}
              >
                Lower the pour to 1u
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="primary" disabled={!ready} onClick={() => onConfirm(draft)}>
        Continue
      </button>
    </section>
  )
}
