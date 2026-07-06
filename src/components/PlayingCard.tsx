import type { Card, Suit } from '../lib/durak'
import { cn } from '../lib/cn'

interface PlayingCardProps {
  card?: Card
  faceDown?: boolean
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  dim?: boolean
  highlight?: boolean
  className?: string
  style?: React.CSSProperties
}

const SZ = {
  sm: { w: 34, h: 48 },
  md: { w: 50, h: 70 },
  lg: { w: 66, h: 92 },
}

const SUIT_CODE: Record<Suit, string> = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }
const cardSrc = (c: Card) => `/assets/durak/cards/${c.rank}${SUIT_CODE[c.suit]}.png`

export function PlayingCard({
  card,
  faceDown,
  size = 'md',
  onClick,
  dim,
  highlight,
  className,
  style,
}: PlayingCardProps) {
  const s = SZ[size]
  const radius = Math.round(s.w * 0.11)

  if (faceDown || !card) {
    return (
      <div
        className={cn(
          'shrink-0 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.25)]',
          className,
        )}
        style={{ width: s.w, height: s.h, borderRadius: radius, ...style }}
      >
        <img
          src="/assets/durak/card-back.png"
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      style={{ width: s.w, height: s.h, borderRadius: radius, ...style }}
      className={cn(
        'relative shrink-0 overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition',
        onClick && 'active:scale-95',
        highlight && '-translate-y-2.5 shadow-[0_7px_16px_rgba(0,0,0,0.35)]',
        dim && 'opacity-60 brightness-90',
        className,
      )}
    >
      <img
        src={cardSrc(card)}
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
        style={{ padding: Math.round(s.w * 0.06) }}
      />
    </Comp>
  )
}
