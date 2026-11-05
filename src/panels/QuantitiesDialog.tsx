import { AlertTriangle, CheckCircle2, Download, Info, RotateCcw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { buildingChecks, type CheckLevel } from '@/plan/checks'
import { billOfMaterials, bomCsv, measureRooms, QTY_GROUPS } from '@/plan/quantities'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { download } from '@/viewport/bridge'
import { IconButton } from '@/ui/primitives'

const kr = (n: number) => `${Math.round(n).toLocaleString('da-DK')} kr`
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

const LEVEL_ICON: Record<CheckLevel, React.ReactNode> = {
  ok: <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />,
  warn: <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />,
  info: <Info className="size-3.5 shrink-0 text-sky-400" />,
}

/** What the plan takes to build and furnish, with a price guide; and the building-regulation checks. */
export function QuantitiesDialog({ onClose, initialTab = 'bom' }: { onClose: () => void; initialTab?: 'bom' | 'checks' }) {
  const project = useActiveProject()
  const [tab, setTab] = useState(initialTab)
  const { setPrice } = useWorkspace.getState()
  const rooms = useMemo(() => measureRooms(project), [project.levels, project.walls, project.openings, project.rooms]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => billOfMaterials(project, rooms), [rooms, project]) // eslint-disable-line react-hooks/exhaustive-deps
  const checks = useMemo(() => buildingChecks(rooms), [rooms])
  const prices = project.prices ?? {}
  const priceOf = (key: string, fallback: number) => prices[key] ?? fallback
  const total = rows.reduce((s, r) => s + priceOf(r.key, r.price) * r.qty, 0)
  const floorArea = rooms.reduce((s, r) => s + r.area, 0)
  const warnings = checks.filter((c) => c.level === 'warn').length

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Quantities and checks" className="flex h-[min(88vh,820px)] w-full max-w-3xl flex-col rounded-xl border border-white/[0.06] bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex rounded-lg bg-app/70 p-0.5">
            {(
              [
                ['bom', 'Materials & cost'],
                ['checks', `BR18 checks${warnings ? ` · ${warnings}` : ''}`],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={cn('h-6.5 rounded-md px-2.5 text-xs transition-colors', tab === id ? 'bg-active text-fg' : 'text-dim hover:text-fg')}>
                {label}
              </button>
            ))}
          </div>
          <span className="ml-1 text-2xs text-faint">
            {rooms.length} rooms · {floorArea.toFixed(1)} m²
          </span>
          <div className="flex-1" />
          {tab === 'bom' && (
            <button
              type="button"
              disabled={!rows.length}
              onClick={() => download(new Blob([bomCsv(rows, prices)], { type: 'text/csv;charset=utf-8' }), `${project.name.replace(/[^\w.-]+/g, '_') || 'plan'}_materials.csv`)}
              className="flex h-7 items-center gap-1.5 rounded-md bg-panel-2 px-2.5 text-xs text-dim transition-colors hover:text-fg disabled:opacity-40"
            >
              <Download className="size-3.5" /> CSV
            </button>
          )}
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === 'bom' ? (
            rows.length ? (
              <table className="w-full text-xs">
                <thead className="text-2xs text-faint">
                  <tr className="text-left">
                    <th className="pb-1.5 font-normal">Item</th>
                    <th className="pb-1.5 text-right font-normal">Qty</th>
                    <th className="w-28 pb-1.5 text-right font-normal">Unit price</th>
                    <th className="w-24 pb-1.5 text-right font-normal">Total</th>
                  </tr>
                </thead>
                {QTY_GROUPS.map((g) => {
                  const rs = rows.filter((r) => r.group === g)
                  if (!rs.length) return null
                  const sub = rs.reduce((s, r) => s + priceOf(r.key, r.price) * r.qty, 0)
                  return (
                    <tbody key={g}>
                      <tr>
                        <td colSpan={3} className="pt-3 pb-1 text-2xs font-medium uppercase tracking-wide text-dim">
                          {g}
                        </td>
                        <td className="pt-3 pb-1 text-right text-2xs text-dim tabular-nums">{kr(sub)}</td>
                      </tr>
                      {rs.map((r) => {
                        const edited = prices[r.key] !== undefined
                        return (
                          <tr key={r.key} className="border-t border-line/60 align-top">
                            <td className="py-1.5 pr-2">
                              <div className="flex items-center gap-1.5 text-fg">
                                {r.swatch && <span className="size-2.5 shrink-0 rounded-full ring-1 ring-white/15" style={{ background: r.swatch }} />}
                                {r.name}
                              </div>
                              <div className="text-2xs leading-snug text-faint">{r.detail}</div>
                            </td>
                            <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-dim">
                              {qty(r.qty)} {r.unit}
                            </td>
                            <td className="py-1 pl-2 text-right">
                              <span className="inline-flex items-center gap-0.5">
                                {edited && (
                                  <button type="button" title="Back to the guide price" onClick={() => setPrice(r.key, null)} className="text-faint hover:text-fg">
                                    <RotateCcw className="size-3" />
                                  </button>
                                )}
                                <input
                                  aria-label={`Unit price of ${r.name}`}
                                  inputMode="decimal"
                                  key={`${r.key}:${priceOf(r.key, r.price)}`}
                                  defaultValue={priceOf(r.key, r.price)}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value.replace(',', '.'))
                                    if (Number.isFinite(v) && v >= 0 && v !== priceOf(r.key, r.price)) setPrice(r.key, v)
                                  }}
                                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                                  className={cn('h-6 w-20 rounded bg-app/60 px-1.5 text-right text-xs tabular-nums outline-none focus:ring-1 focus:ring-accent', edited ? 'text-accent' : 'text-fg')}
                                />
                              </span>
                            </td>
                            <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-fg">{kr(priceOf(r.key, r.price) * r.qty)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  )
                })}
                <tfoot>
                  <tr className="border-t border-line-strong">
                    <td colSpan={3} className="pt-2 text-sm font-medium text-fg">
                      Estimate
                    </td>
                    <td className="pt-2 text-right text-sm font-medium tabular-nums text-fg">{kr(total)}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="py-8 text-center text-xs text-dim">Draw some rooms first: the list fills in from the plan.</p>
            )
          ) : checks.length ? (
            <ul className="flex flex-col gap-1">
              {checks.map((c, i) => (
                <li key={i} className="flex gap-2 rounded-md px-2 py-1.5 hover:bg-hover/50">
                  <span className="mt-0.5">{LEVEL_ICON[c.level]}</span>
                  <div className="min-w-0">
                    <div className="text-xs text-fg">
                      <span className="text-dim">{c.room}</span> · {c.title}
                    </div>
                    <div className="text-2xs leading-snug text-faint">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-xs text-dim">Name your rooms (Living room, Bedroom, Bathroom…) to check them.</p>
          )}
        </div>

        <p className="border-t border-line px-4 py-2 text-2xs leading-snug text-faint">
          {tab === 'bom'
            ? 'Guide prices in DKK incl. VAT, materials only (no labour). Floors and trim include waste; paint is 2 coats. Click a price to use your own quote.'
            : 'Guidance from the plan as drawn, after the Danish building regulations (BR18) for new homes. Not an approval: check the rules or ask a professional before you build.'}
        </p>
      </div>
    </div>,
    document.body,
  )
}
