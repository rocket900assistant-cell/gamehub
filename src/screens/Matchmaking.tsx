import { Loader2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { t } from '../lib/i18n'

interface MatchmakingProps {
  minutes: number
  label?: string
  subtitle?: string
  onCancel: () => void
}

export function Matchmaking({ minutes, label, subtitle, onCancel }: MatchmakingProps) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="relative grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-gold/30" />
        <div className="grid h-20 w-20 place-items-center rounded-full bg-gold-light/50">
          <Loader2 size={34} className="animate-spin text-gold-dark" />
        </div>
      </div>
      <div>
        <p className="text-xl font-extrabold">{label ?? t('mm.searching')}</p>
        <p className="mt-1 text-sm text-muted">
          {subtitle ?? `${t('game.chess')} · ${minutes} ${t('unit.min')}`}
        </p>
      </div>
      <Button variant="secondary" onClick={onCancel}>
        {t('mm.cancel')}
      </Button>
    </div>
  )
}
