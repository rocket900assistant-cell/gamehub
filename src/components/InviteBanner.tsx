import { Swords, X } from 'lucide-react'
import { Button } from './ui/Button'
import type { IncomingInvite } from '../lib/socket'

interface InviteBannerProps {
  invite: IncomingInvite
  onAccept: () => void
  onDecline: () => void
}

const GAME_LABEL: Record<string, string> = {
  chess: 'Шахматы',
  durak: 'Дурак',
  nardy: 'Нарды',
}

export function InviteBanner({ invite, onAccept, onDecline }: InviteBannerProps) {
  const label = GAME_LABEL[invite.game] ?? 'Игра'
  // For durak the "minutes" field carries the deck size, not a clock.
  const detail = invite.game === 'durak' ? `${invite.minutes} карт` : `${invite.minutes} мин`
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-gold bg-gold-light/40 p-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold text-white">
        <Swords size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold leading-tight">
          {invite.from.name ?? 'Друг'} зовёт в партию
        </p>
        <p className="text-xs text-muted">{label} · {detail}</p>
      </div>
      <Button size="sm" onClick={onAccept}>
        Зайти
      </Button>
      <button onClick={onDecline} aria-label="Отклонить" className="text-muted">
        <X size={18} />
      </button>
    </div>
  )
}
