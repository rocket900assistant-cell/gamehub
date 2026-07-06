interface SectionHeaderProps {
  title: string
  actionLabel?: string
  onAction?: () => void
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {actionLabel && (
        <button
          onClick={onAction}
          className="text-sm font-semibold text-gold transition active:opacity-70"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
