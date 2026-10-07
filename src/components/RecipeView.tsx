import { useState } from 'react'
import { cmdLine, describeBeforehand, describeCmd, describeCool, describeMix, formatPaper } from '../engine/plan'
import { formatUnits } from '../format'
import { formatDrugLabel } from '../labels'
import type { PlanStep, RecipePlan } from '../types'

type Props = {
  plan: RecipePlan
  chemMaster: boolean
  title: string
}

function stepTag(step: Extract<PlanStep, { kind: 'mim' | 'mixer' | 'grind' }>, chemMaster: boolean): string {
  if (step.kind === 'grind') return step.method === 'juice' ? 'JUICE' : 'GRIND'
  if (step.kind === 'mixer') return (step.mixer ?? 'MIXER').toUpperCase()
  return chemMaster ? 'MIM' : ''
}

function StepList({ steps, chemMaster }: { steps: PlanStep[]; chemMaster: boolean }) {
  return (
    <ol className="steps">
      {steps.map((step, i) => {
        if (step.kind === 'heat') return null
        if (step.kind === 'cool') {
          return (
            <li key={`c-${i}`} className="cool">
              {describeCool(step.temp)}
            </li>
          )
        }
        const tag = stepTag(step, chemMaster)
        return (
          <li key={`${step.reagentId}-${i}`}>
            <div className="step-head">
              <span className="chip" style={{ background: step.color ?? '#444' }} />
              <strong>{tag ? `${step.title} — ${tag}` : step.title}</strong>
              <span className="prod">{formatUnits(step.produced)}u</span>
            </div>
            <p>{describeMix(step, chemMaster)}</p>
          </li>
        )
      })}
    </ol>
  )
}

export function RecipeView({ plan, chemMaster, title }: Props) {
  const [copied, setCopied] = useState(false)

  async function copyPaper() {
    const text = formatPaper(plan, title, chemMaster)
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
        <h2>Recipe</h2>
        <button type="button" className="ghost" onClick={() => void copyPaper()}>
          {copied ? 'Copied' : 'Copy for paper'}
        </button>
      </header>
      <article className="paper">
        {plan.mass && <p className="note">Easy batches</p>}
        <p className="shorthand">
          {chemMaster && (
            <>
              <strong>CMD</strong> Chem Master Dump · <strong>MIM</strong> Mix in Master ·{' '}
            </>
          )}
          <strong>GRIND</strong> / <strong>JUICE</strong> Reagent grinder
        </p>
        {plan.warnings.length > 0 && (
          <div className="warn">
            {plan.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        {plan.beforehand.length > 0 && (
          <>
            <h3>Beforehand</h3>
            <ul className="beforehand">
              {plan.beforehand.map((entry) => (
                <li key={`${entry.measure ?? 'u'}-${entry.id}`}>{describeBeforehand(entry)}</li>
              ))}
            </ul>
          </>
        )}
        {plan.process.length > 0 && (
          <>
            <h3>Process</h3>
            <StepList steps={plan.process} chemMaster={chemMaster} />
          </>
        )}
        <h3>Start here</h3>
        {plan.cmd.dispenser.length > 0 && (
          <>
            <h3>Chem dispenser</h3>
            <p className="cmd">{cmdLine(plan.cmd.dispenser)}</p>
          </>
        )}
        {plan.cmd.vend.length > 0 && (
          <>
            <h3>ChemVend</h3>
            <p className="cmd">{cmdLine(plan.cmd.vend)}</p>
          </>
        )}
        {plan.cmd.other.length > 0 && <p className="cmd">{describeCmd(plan.cmd.other, chemMaster)}</p>}
        {plan.cmd.dispenser.length === 0 && plan.cmd.vend.length === 0 && plan.cmd.other.length === 0 && (
          <p className="cmd">{describeCmd([], chemMaster)}</p>
        )}
        <StepList steps={plan.steps} chemMaster={chemMaster} />
        {plan.steps.length === 0 && (
          <p className="note">
            {chemMaster
              ? 'Nothing to mix — dump the listed chems and you are done.'
              : 'Nothing to mix — pour the listed chems and you are done.'}
          </p>
        )}
        {plan.extra.length > 0 && (
          <div className="extra">
            <h3>Extra</h3>
            <ul>
              {plan.extra.map((entry) => (
                <li key={entry.id}>
                  {entry.name} {formatUnits(entry.amount)}u
                </li>
              ))}
            </ul>
          </div>
        )}
        {plan.labels.length > 0 && (
          <div className="labels">
            <h3>Labels</h3>
            <ul>
              {plan.labels.map((label) => (
                <li key={label.id}>{formatDrugLabel(label)}</li>
              ))}
            </ul>
          </div>
        )}
      </article>
    </section>
  )
}
