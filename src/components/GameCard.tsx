import { Users } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Game } from '../data/mock'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { DurakArt } from './illustrations/DurakArt'
import { ChessArt } from './illustrations/ChessArt'

const art: Record<string, { node: ReactNode; bg: string }> = {
  durak: {
    node: <DurakArt className="h-full w-auto drop-shadow-sm" />,
    bg: 'bg-gradient-to-br from-gold-light/50 via-surface to-danger/10',
  },
  chess: {
    node: <ChessArt className="h-full w-auto" />,
    bg: 'bg-gradient-to-br from-line via-surface to-gold-light/40',
  },
}

interface GameCardProps {
  game: Game
  onPlay: (id: string) => void
}

export function GameCard({ game, onPlay }: GameCardProps) {
  const a = art[game.id]

  return (
    <Card flush className="flex flex-col">
      <div className={`flex h-32 items-center justify-center px-3 ${a?.bg ?? ''}`}>
        {a?.node}
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="text-base font-bold">{game.name}</h3>
        <p className="mt-0.5 text-xs text-muted">{game.tagline}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs font-medium text-muted">
            <Users size={13} />
            {game.online.toLocaleString('ru-RU')}
          </span>
          <Button size="sm" onClick={() => onPlay(game.id)}>
            Играть
          </Button>
        </div>
      </div>
    </Card>
  )
}
