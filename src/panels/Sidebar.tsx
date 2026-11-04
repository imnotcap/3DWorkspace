import { Armchair, Layers } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Catalog } from './Catalog'
import { Outliner } from './Outliner'

type Tab = 'catalog' | 'scene'
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'catalog', label: 'Furniture', icon: <Armchair className="size-3.5" /> },
  { id: 'scene', label: 'Scene', icon: <Layers className="size-3.5" /> },
]

/** Furniture catalog and the scene tree. */
export function Sidebar() {
  const [tab, setTab] = useState<Tab>('catalog')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-0.5 border-b border-line p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('flex h-6.5 flex-1 items-center justify-center gap-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-active text-fg' : 'text-dim hover:bg-hover hover:text-fg')}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === 'catalog' ? <Catalog /> : <Outliner />}</div>
    </div>
  )
}
