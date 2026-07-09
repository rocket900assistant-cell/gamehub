import { ArrowLeft, ClipboardList, Crown, Dices, Gamepad2, Spade } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../components/ui/Card'
import type { HistoryEntry } from '../lib/socket'

const GAME: Record<string, { label: string; icon: LucideIcon }> = {
  chess: { label: 'Шахматы', icon: Crown },
  durak: { label: 'Дурак', icon: Spade },
  nardy: { label: 'Нарды', icon: Dices },
}

const RESULT: Record<HistoryEntry['result'], { label: string; cls: string }> = {
  win: { label: 'Победа', cls: 'text-success bg-success/12' },
  loss: { label: 'Поражение', cls: 'text-danger bg-danger/12' },
  draw: { label: 'Ничья', cls: 'text-muted bg-line' },
}

function fmt(at: string) {
  const d = new Date(at)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function History({ list, onBack }: { list: HistoryEntry[]; onBack: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold">История матчей</h1>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-bg text-muted">
            <ClipboardList size={26} />
          </div>
          <div>
            <p className="font-bold">Пока нет матчей</p>
            <p className="mt-0.5 text-sm text-muted">Сыграй онлайн — партии появятся здесь</p>
          </div>
        </div>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden p-0">
          {list.map((m, i) => {
            const g = GAME[m.game] ?? { label: m.game, icon: Gamepad2 }
            const r = RESULT[m.result]
            const Icon = g.icon
            return (
              <div key={i} className="flex items-center gap-3 p-3.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-light/40 text-gold-dark">
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-tight">{g.label}</p>
                  <p className="text-xs text-muted">{fmt(m.at)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${r.cls}`}>
                  {r.label}
                </span>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
