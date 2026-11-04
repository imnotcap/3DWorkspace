import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** Shown before the label (a swatch, a texture thumbnail…). */
  preview?: ReactNode
  hint?: string
}

/**
 * A dropdown in the app's own look (the browser's native list ignores the theme): a button and a
 * floating list, kept on screen, with the keyboard (arrows, Home/End, Enter, Esc, type to jump).
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: SelectOption<T>[]
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ s: '', t: 0 })
  const current = options.find((o) => o.value === value)

  const place = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const want = Math.min(320, options.length * 28 + 10)
    const up = below < want && above > below
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 8)), top: up ? window.innerHeight - r.top + 4 : r.bottom + 4, width: r.width, up, max: Math.max(120, Math.min(320, up ? above : below)) })
  }
  const show = () => {
    place()
    setHi(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (i: number) => {
    const o = options[i]
    if (o) onChange(o.value)
    setOpen(false)
    btn.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !btn.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && setOpen(false)
    const reflow = (e: Event) => (list.current?.contains(e.target as Node) ? undefined : setOpen(false))
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', reflow)
    window.addEventListener('scroll', reflow, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', reflow)
      window.removeEventListener('scroll', reflow, true)
    }
  }, [open])
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, hi])

  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.min(options.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(0, h - 1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setHi(e.key === 'Home' ? 0 : options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(hi)
    } else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      const now = performance.now()
      typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : '') + e.key.toLowerCase(), t: now }
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.s))
      if (i >= 0) setHi(i)
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.preventDefault()
          if (open) setOpen(false)
          else show()
        }}
        onKeyDown={onKey}
        className={cn(
          inputCls,
          'flex items-center gap-1.5 text-left',
          size === 'sm' && 'h-6 w-auto border-transparent bg-raised px-1.5 text-2xs',
          open && 'border-accent',
          className,
        )}
      >
        {current?.preview}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ''}</span>
        <svg className={cn('size-2.5 shrink-0 text-dim transition-transform', open && 'rotate-180')} viewBox="0 0 10 10">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={list}
              role="listbox"
              initial={{ opacity: 0, y: pos.up ? 3 : -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.06 } }}
              transition={{ duration: 0.1, ease }}
              style={{ left: pos.left, ...(pos.up ? { bottom: pos.top } : { top: pos.top }), minWidth: Math.max(pos.width, 120), maxHeight: pos.max }}
              className="fixed z-[100] overflow-y-auto rounded-lg border border-line-strong bg-panel-2/95 p-1 shadow-xl shadow-black/50 backdrop-blur-md"
            >
              {options.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  data-i={i}
                  onPointerEnter={() => setHi(i)}
                  onClick={() => pick(i)}
                  className={cn('flex min-h-6.5 w-full items-center gap-2 rounded-md px-2 py-0.5 text-left text-xs', i === hi ? 'bg-accent/90 text-white' : 'text-fg')}
                >
                  <span className="w-3 shrink-0 text-center text-2xs">{o.value === value ? '✓' : ''}</span>
                  {o.preview}
                  <span className="flex-1 whitespace-nowrap">{o.label}</span>
                  {o.hint && <span className={cn('text-2xs', i === hi ? 'text-white/70' : 'text-faint')}>{o.hint}</span>}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
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
