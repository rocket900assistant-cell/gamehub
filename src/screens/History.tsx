import { ArrowLeft, ClipboardList, Crown, Dices, Gamepad2, Spade } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../components/ui/Card'
import type { HistoryEntry } from '../lib/socket'
import { t } from '../lib/i18n'

const GAME_ICON: Record<string, LucideIcon> = {
  chess: Crown,
  durak: Spade,
  nardy: Dices,
}

const RESULT_CLS: Record<HistoryEntry['result'], string> = {
  win: 'text-success bg-success/12',
  loss: 'text-danger bg-danger/12',
  draw: 'text-muted bg-line',
}
const RESULT_KEY: Record<HistoryEntry['result'], string> = {
  win: 'history.win',
  loss: 'history.loss',
  draw: 'history.draw',
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
        <h1 className="text-2xl font-extrabold">{t('history.title')}</h1>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 py-12 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-bg text-muted">
            <ClipboardList size={26} />
          </div>
          <div>
            <p className="font-bold">{t('history.emptyTitle')}</p>
            <p className="mt-0.5 text-sm text-muted">{t('history.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <Card className="divide-y divide-line/70 overflow-hidden p-0">
          {list.map((m, i) => {
            const Icon = GAME_ICON[m.game] ?? Gamepad2
            const label = GAME_ICON[m.game] ? t(`game.${m.game}`) : m.game
            return (
              <div key={i} className="flex items-center gap-3 p-3.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-light/40 text-gold-dark">
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-tight">{label}</p>
                  <p className="text-xs text-muted">{fmt(m.at)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${RESULT_CLS[m.result]}`}>
                  {t(RESULT_KEY[m.result])}
                </span>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
