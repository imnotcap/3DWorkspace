import { Armchair, Camera, Layers } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Catalog } from './Catalog'
import { InputsPanel } from './InputsPanel'
import { Outliner } from './Outliner'

type Tab = 'catalog' | 'scene' | 'photo'
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'catalog', label: 'Furniture', icon: <Armchair className="size-3.5" /> },
  { id: 'scene', label: 'Scene', icon: <Layers className="size-3.5" /> },
  { id: 'photo', label: 'Photo → 3D', icon: <Camera className="size-3.5" /> },
]

/** Furniture catalog, the scene tree, and custom pieces from a photo (SAM 3D). */
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
      <div className="min-h-0 flex-1">{tab === 'catalog' ? <Catalog /> : tab === 'scene' ? <Outliner /> : <InputsPanel />}</div>
    </div>
  )
}
