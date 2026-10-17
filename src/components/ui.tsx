import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useId } from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const SPRING = { type: 'spring', stiffness: 480, damping: 32, mass: 0.7 } as const

type Variant = 'primary' | 'outline' | 'quiet' | 'danger'

/** motion 的按钮 props 和原生 animation/drag 事件签名冲突，这里先剔掉再扩展 */
type NativeButtonProps = Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration' | 'onDrag' | 'onDragStart' | 'onDragEnd'
>

const VARIANT_CLS: Record<Variant, string> = {
  primary:
    'bg-ink text-white border border-ink hover:bg-[#1d1d1d] disabled:bg-line-strong disabled:border-line-strong disabled:text-white/70',
  outline:
    'bg-white text-ink border border-line-strong hover:border-ink/40 hover:bg-white disabled:text-muted',
  quiet: 'bg-black/[0.045] text-ink border border-transparent hover:bg-black/[0.075] disabled:text-muted',
  danger: 'bg-white text-danger border border-danger/30 hover:bg-danger/[0.06]',
}

export function Button({
  variant = 'primary',
  full,
  icon,
  children,
  className,
  ...rest
}: {
  variant?: Variant
  full?: boolean
  icon?: ReactNode
  children?: ReactNode
  className?: string
} & NativeButtonProps) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -1.5 }}
      whileTap={{ scale: 0.965, y: 0 }}
      transition={SPRING}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-full px-5 py-3 text-[15px] font-medium',
        'transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        full && 'w-full',
        VARIANT_CLS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  )
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: { label: string; children: ReactNode; className?: string } & NativeButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      whileHover={{ scale: 1.06, rotate: -0.5 }}
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
      className={cx(
        'grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-white text-ink',
        'transition-colors duration-200 hover:border-ink/30 outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-2',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  const id = useId()
  return (
    <div className="flex rounded-full bg-black/[0.045] p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              'relative flex-1 rounded-full whitespace-nowrap transition-colors duration-200 outline-none',
              'focus-visible:ring-2 focus-visible:ring-accent/40',
              size === 'sm' ? 'px-2.5 py-1.5 text-[12px]' : 'px-3 py-2 text-[13px]',
              active ? 'text-ink' : 'text-muted hover:text-ink-soft',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.14)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 font-medium">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium tracking-tight text-ink-soft">{label}</span>
        {hint && <span className="text-[12px] tabular-nums text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <motion.div
          className="h-full rounded-full bg-ink"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
          transition={{ type: 'spring', stiffness: 180, damping: 26 }}
        />
      </div>
      {label && <p className="text-[12px] tabular-nums text-muted">{label}</p>}
    </div>
  )
}
