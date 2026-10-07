import { useMemo, useRef, useState } from 'react'
import { shortName } from '../format'
import { itemIncluded, type Category, type ReagentInfo } from '../types'

type Props = {
  category: Category
  reagents: Map<string, ReagentInfo>
  onChange: (next: Category) => void
  editing: boolean
}

export function CategoryEditor({ category, reagents, onChange, editing }: Props) {
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = [...reagents.values()].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return all.slice(0, 40)
    return all
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          shortName(r.id, r.name).toLowerCase().includes(q),
      )
      .slice(0, 40)
  }, [query, reagents])

  function setItem(index: number, patch: Partial<Category['items'][number]>) {
    const items = category.items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    onChange({ ...category, items })
  }

  function addChem(id: string) {
    if (category.items.some((i) => i.id === id)) return
    onChange({
      ...category,
      items: [...category.items, { id, amount: 240, optional: false }],
    })
    setQuery('')
  }

  function remove(index: number) {
    onChange({ ...category, items: category.items.filter((_, i) => i !== index) })
  }

  function moveTo(overId: string) {
    const dragging = dragIdRef.current
    if (!dragging || dragging === overId) return
    const from = category.items.findIndex((item) => item.id === dragging)
    const to = category.items.findIndex((item) => item.id === overId)
    if (from < 0 || to < 0) return
    const items = [...category.items]
    const [item] = items.splice(from, 1)
    items.splice(to, 0, item)
    onChange({ ...category, items })
  }

  return (
    <section className="editor">
      <h2>What you're making</h2>
      {editing ? (
        <label className="desc">
          Description
          <textarea
            value={category.note ?? ''}
            rows={3}
            placeholder="Optional note for this category"
            onChange={(e) => onChange({ ...category, note: e.target.value })}
          />
        </label>
      ) : (
        category.note && <p className="note">{category.note}</p>
      )}
      <ul className="chem-list">
        {category.items.map((item, index) => {
          const info = reagents.get(item.id)
          const color = info?.color ?? '#888'
          return (
            <li
              key={item.id}
              className={item.id === dragId ? 'dragging' : undefined}
              onDragOver={(event) => {
                event.preventDefault()
                moveTo(item.id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                dragIdRef.current = null
                setDragId(null)
              }}
            >
              {editing && (
                <button
                  type="button"
                  className="cat-grip"
                  draggable
                  aria-label={`Reorder ${shortName(item.id, info?.name)}`}
                  onDragStart={(event) => {
                    dragIdRef.current = item.id
                    setDragId(item.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', item.id)
                  }}
                  onDragEnd={() => {
                    dragIdRef.current = null
                    setDragId(null)
                  }}
                >
                  ⋮⋮
                </button>
              )}
              <span className="swatch" style={{ background: color }} />
              <span className="chem-label">
                <strong>{shortName(item.id, info?.name)}</strong>
                <span>{info?.name ?? item.id}</span>
              </span>
              {editing ? (
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={item.amount}
                  onChange={(e) => setItem(index, { amount: Number(e.target.value) || 0 })}
                  aria-label={`${item.id} units`}
                />
              ) : (
                <span className="chem-amount">{item.amount}</span>
              )}
              <span className="unit">u</span>
              <label className="opt">
                <input
                  type="checkbox"
                  checked={itemIncluded(item)}
                  onChange={(e) => setItem(index, { enabled: e.target.checked })}
                />
                include
              </label>
              {editing && (
                <button type="button" className="ghost" onClick={() => remove(index)}>
                  Remove
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {editing && (
      <div className="add-chem">
        <input
          placeholder="Add a chemical…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <ul className="suggest">
            {list.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => addChem(r.id)}>
                  <span className="swatch" style={{ background: r.color ?? '#555' }} />
                  {r.name}
                  <em>{shortName(r.id, r.name)}</em>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="empty">No matches</li>}
          </ul>
        )}
      </div>
      )}
    </section>
  )
}
