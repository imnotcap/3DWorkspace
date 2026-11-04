import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const ease = [0.2, 0, 0, 1] as const

/* ───────── Tooltip ───────── */

type Side = 'right' | 'left' | 'bottom' | 'top'
const sidePos: Record<Side, string> = {
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
}

export function Tooltip({ label, shortcut, side = 'right', children }: { label: string; shortcut?: string; side?: Side; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number>(0)
  return (
    <div
      className="relative flex"
      onPointerEnter={() => (timer.current = window.setTimeout(() => setOpen(true), 450))}
      onPointerLeave={() => (clearTimeout(timer.current), setOpen(false))}
      onPointerDown={() => (clearTimeout(timer.current), setOpen(false))}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1, ease }}
            className={cn(
              'pointer-events-none absolute z-50 flex items-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-raised px-2 py-1 text-xs text-fg shadow-lg shadow-black/40',
              sidePos[side],
            )}
          >
            {label}
            {shortcut && <kbd className="font-mono text-2xs text-dim">{shortcut}</kbd>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────── Buttons ───────── */

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: 'sm' | 'md'
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ active, size = 'md', className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'grid shrink-0 place-items-center rounded-md text-dim transition-colors duration-100 hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'size-7' : 'size-5',
        active && 'bg-active text-fg',
        className,
      )}
      {...props}
    />
  )
})

export function Button({ variant = 'default', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary' && 'bg-fg text-app hover:bg-white',
        variant === 'default' && 'border border-line-strong bg-raised text-fg hover:bg-hover',
        variant === 'ghost' && 'text-dim hover:bg-hover hover:text-fg',
        className,
      )}
      {...props}
    />
  )
}

/* ───────── Menu ───────── */

export interface MenuItem {
  label: string
  shortcut?: string
  onSelect?: () => void
  disabled?: boolean
  checked?: boolean
  separator?: boolean
}

export function Menu({ trigger, items, align = 'left', className }: { trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-6 items-center gap-1 rounded px-2 text-xs text-dim transition-colors hover:bg-hover hover:text-fg', open && 'bg-hover text-fg', className)}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2, transition: { duration: 0.08 } }}
            transition={{ duration: 0.12, ease }}
            className={cn(
              'absolute top-full z-50 mt-1 min-w-48 rounded-lg border border-line-strong bg-panel-2/95 p-1 shadow-xl shadow-black/50 backdrop-blur-md',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {items.map((item, i) =>
              item.separator ? (
                <div key={i} className="mx-1 my-1 h-px bg-line-strong" />
              ) : (
                <button
                  key={i}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect?.()
                  }}
                  className="flex h-6.5 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-fg hover:bg-accent/90 hover:text-white disabled:pointer-events-none disabled:text-faint"
                >
                  <span className="w-3 text-center text-2xs">{item.checked ? '✓' : ''}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && <kbd className="font-mono text-2xs opacity-60">{item.shortcut}</kbd>}
                </button>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────── Form fields ───────── */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-1">
      <span className="truncate text-xs text-dim">{label}</span>
      <div className="min-w-0">{children}</div>
      {hint && <span className="col-start-2 text-2xs leading-snug text-faint">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'h-6.5 w-full rounded-md border border-line-strong bg-app/60 px-2 text-xs text-fg placeholder:text-faint outline-none transition-colors focus:border-accent'

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(inputCls, 'appearance-none pr-6')}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-panel-2">
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2 top-1/2 size-2.5 -translate-y-1/2 text-dim" viewBox="0 0 10 10">
        <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </div>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('relative h-4 w-7 rounded-full border transition-colors duration-150', checked ? 'border-accent bg-accent' : 'border-line-strong bg-app')}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-2.5 rounded-full bg-white"
        animate={{ x: checked ? 12 : 0 }}
        transition={{ type: 'spring', stiffness: 700, damping: 40 }}
      />
    </button>
  )
}

/** Slider with value readout, like the material editors in DCC apps. */
export function Slider({ value, min, max, step = 0.01, onChange, format = (v) => v.toFixed(2) }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 rounded border border-line-strong bg-app/60 py-0.5 text-center font-mono text-2xs tabular text-fg">{format(value)}</span>
      <div className="relative h-4 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-app">
          <div className="h-full rounded-full bg-fg/80" style={{ width: `${pct}%` }} />
        </div>
        <div className="pointer-events-none absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow" style={{ left: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full cursor-ew-resize opacity-0"
        />
      </div>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2.5">
      <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">{children}</span>
      {right}
    </div>
  )
}
