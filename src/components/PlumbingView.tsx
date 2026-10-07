import { useState } from 'react'
import { formatUnits } from '../format'
import {
  describePlumbingStep,
  formatPlumbing,
  type PlumbingGuide,
  type PlumbingStep,
  type PlumbingSupplies,
  type PlumbingSupply,
} from '../engine/plumbing'

type Props = {
  title: string
  guides: PlumbingGuide[]
  supplies: PlumbingSupplies
}

function SupplyList({ title, items }: { title: string; items: PlumbingSupply[] }) {
  if (!items.length) return null
  return (
    <>
      <h3>{title}</h3>
      <ul className="beforehand">
        {items.map((item) => (
          <li key={item.id}>
            {item.name} {formatUnits(item.amount)}
          </li>
        ))}
      </ul>
    </>
  )
}

function heading(step: PlumbingStep): string {
  if (step.kind === 'grind') return `${step.productName} — GRIND`
  if (step.mixer) return `${step.productName} — ${step.mixer.toUpperCase()}`
  return step.productName
}

export function PlumbingView({ title, guides, supplies }: Props) {
  const cards = guides.flatMap((guide) => guide.steps.map((step) => ({ name: guide.name, step })))
  const [index, setIndex] = useState(0)
  const [seenGuides, setSeenGuides] = useState(guides)
  const [copied, setCopied] = useState(false)
  if (seenGuides !== guides) {
    setSeenGuides(guides)
    setIndex(0)
  }
  async function copyPaper() {
    const text = formatPlumbing(title, guides, supplies)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
  }

  return (
    <section className="recipe">
      <header className="recipe-head">
        <h2>Plumbing</h2>
        <button type="button" className="ghost" onClick={() => void copyPaper()}>
          {copied ? 'Copied' : 'Copy for paper'}
        </button>
      </header>
      <article className="paper">
        <p className="note">120u mixes. Pours are 10u, or 1u when a mix would not fit.</p>
        <div className="notecard-deck">
          <article className="notecard" aria-hidden={index !== 0} inert={index !== 0}>
            <h3>Ingredients</h3>
            <SupplyList title="Chem dispenser" items={supplies.dispenser} />
            <SupplyList title="ChemVend" items={supplies.vend} />
            <SupplyList title="Outside" items={supplies.outside} />
          </article>
          {cards.map((mix, cardIndex) => (
            <article
              key={`${mix.step.productId}-${cardIndex}`}
              className="notecard"
              aria-hidden={index !== cardIndex + 1}
              inert={index !== cardIndex + 1}
            >
              {mix.name ? <p className="shorthand">{mix.name}</p> : null}
              <h3>{heading(mix.step)}</h3>
              <p>{describePlumbingStep(mix.step)}</p>
              {mix.step.overCapacity && <p className="note">Over 120u.</p>}
              {mix.step.pourUnit === 1 && mix.step.kind !== 'grind' && <p className="note">1u pours.</p>}
            </article>
          ))}
        </div>
        <div className="notecard-nav">
          <button type="button" disabled={index === 0} onClick={() => setIndex((current) => current - 1)}>
            Back
          </button>
          <span>
            {index} / {cards.length}
          </span>
          <button
            type="button"
            disabled={index >= cards.length}
            onClick={() => setIndex((current) => current + 1)}
          >
            Forward
          </button>
        </div>
      </article>
    </section>
  )
}
