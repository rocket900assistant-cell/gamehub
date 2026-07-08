import type { Card, Suit } from '../lib/durak'
import { cn } from '../lib/cn'
import { equippedDurakBackSrc } from '../lib/skins'

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
  sm: { w: 40, h: 56 },
  md: { w: 56, h: 78 },
  lg: { w: 80, h: 112 },
}

const SUIT_CODE: Record<Suit, string> = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }
const cardSrc = (c: Card) => `/assets/durak/cards/${c.rank}${SUIT_CODE[c.suit]}.png`

// Preload every card once so faces are cached before they're rendered
// (avoids blank/white cards when many <img> load at the same time).
let _preloaded = false
function preloadCards() {
  if (_preloaded || typeof Image === 'undefined') return
  _preloaded = true
  const urls = [equippedDurakBackSrc()]
  for (let r = 2; r <= 14; r++)
    for (const s of ['S', 'H', 'D', 'C']) urls.push(`/assets/durak/cards/${r}${s}.png`)
  urls.forEach((u) => {
    const img = new Image()
    img.src = u
  })
}
preloadCards()

// Retry a failed image load once (transient network hiccup → blank card).
function retryImg(e: React.SyntheticEvent<HTMLImageElement>) {
  const el = e.currentTarget
  if (el.dataset.retry) return
  el.dataset.retry = '1'
  const base = el.src.split('?')[0]
  el.src = `${base}?r=${Date.now()}`
}

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
          src={equippedDurakBackSrc()}
          alt=""
          draggable={false}
          onError={retryImg}
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
        onError={retryImg}
        className="h-full w-full object-contain"
        style={{ padding: Math.round(s.w * 0.06) }}
      />
    </Comp>
  )
}
