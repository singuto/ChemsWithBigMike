import { useRef, useState } from 'react'
import type { Category } from '../types'

type Props = {
  categories: Category[]
  selectedId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onReorder: (next: Category[]) => void
  editing: boolean
}

export function CategoryList({
  categories,
  selectedId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  editing,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  const dragIdRef = useRef<string | null>(null)

  function moveTo(overId: string) {
    const dragging = dragIdRef.current
    if (!dragging || dragging === overId) return
    const from = categories.findIndex((cat) => cat.id === dragging)
    const to = categories.findIndex((cat) => cat.id === overId)
    if (from < 0 || to < 0) return
    const next = [...categories]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onReorder(next)
  }

  return (
    <aside className="cats">
      <h2>Categories</h2>
      <ul>
        {categories.map((cat) => (
          <li
            key={cat.id}
            className={[cat.id === selectedId ? 'active' : '', cat.id === dragId ? 'dragging' : '']
              .filter(Boolean)
              .join(' ')}
            onDragOver={(event) => {
              event.preventDefault()
              moveTo(cat.id)
            }}
            onDrop={(event) => {
              event.preventDefault()
              dragIdRef.current = null
              setDragId(null)
            }}
          >
            <div className="cat-row">
              {editing && (
                <button
                  type="button"
                  className="cat-grip"
                  draggable
                  aria-label={`Reorder ${cat.name}`}
                  onDragStart={(event) => {
                    dragIdRef.current = cat.id
                    setDragId(cat.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', cat.id)
                  }}
                  onDragEnd={() => {
                    dragIdRef.current = null
                    setDragId(null)
                  }}
                >
                  ⋮⋮
                </button>
              )}
              {editing && cat.id === selectedId ? (
                <div className="cat-edit">
                  <input
                    value={cat.name}
                    onChange={(e) => onRename(cat.id, e.target.value)}
                    aria-label="Category name"
                  />
                  <button type="button" className="danger" onClick={() => onDelete(cat.id)}>
                    Delete
                  </button>
                </div>
              ) : (
                <button type="button" className="cat-name" onClick={() => onSelect(cat.id)}>
                  {cat.name}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <button type="button" onClick={onAdd}>
          + New category
        </button>
      )}
    </aside>
  )
}
