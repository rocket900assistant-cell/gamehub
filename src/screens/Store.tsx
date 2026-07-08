import { useState } from 'react'
import { Check, Star } from 'lucide-react'
import { StarBalance } from '../components/ui/StarBalance'
import { SectionHeader } from '../components/ui/SectionHeader'
import { Button } from '../components/ui/Button'
import { player } from '../data/mock'
import {
  BOARD_SKINS,
  DURAK_BACKS,
  DURAK_FELTS,
  NARDY_CHECKERS,
  PIECE_SKINS,
  VIP_PRICE_STARS,
  type BoardSkin,
  type CheckerSkin,
  type ImageSkin,
  type PieceSkin,
  buy,
  buyVip,
  equipBoard,
  equipChecker,
  equipDurakBack,
  equipDurakFelt,
  equipPiece,
  getEquippedBackId,
  getEquippedBoardId,
  getEquippedCheckerId,
  getEquippedFeltId,
  getEquippedPieceId,
  isOwned,
  isVip,
} from '../lib/skins'

/** Price in Telegram Stars (icon inherits the button text colour). */
function PriceTag({ stars }: { stars: number }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Star size={13} className="fill-current" /> {stars.toLocaleString('ru-RU')}
    </span>
  )
}

// 6 pieces in 3 rows × 2 (white left, black right) on a checker pattern.
const PIECE_ROWS = [
  [
    { c: 'wK', g: '♚' },
    { c: 'bQ', g: '♛' },
  ],
  [
    { c: 'wR', g: '♜' },
    { c: 'bB', g: '♝' },
  ],
  [
    { c: 'wN', g: '♞' },
    { c: 'bP', g: '♟' },
  ],
]

function PiecePreview({ skin }: { skin: PieceSkin }) {
  return (
    <div>
      {PIECE_ROWS.map((row, r) => (
        <div key={r} className="flex">
          {row.map((p, c) => {
            const light = (r + c) % 2 === 0
            return (
              <div
                key={p.c}
                className="grid h-[50px] flex-1 place-items-center"
                style={{ background: light ? '#EEEED2' : '#769656' }}
              >
                {skin.dir ? (
                  <img src={`/piece/${skin.dir}/${p.c}.svg`} alt="" className="h-12 w-12" />
                ) : (
                  <span style={{ fontSize: 32, lineHeight: 1, color: light ? '#3a3a3a' : '#f4f4f4' }}>
                    {p.g}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function BoardPreview({ skin }: { skin: BoardSkin }) {
  const textured = skin.kind === 'texture'
  const cells = Array.from({ length: 64 }, (_, i) => (Math.floor(i / 8) + (i % 8)) % 2)
  return (
    <div
      className="grid aspect-square w-full"
      style={{
        gridTemplateColumns: 'repeat(8,1fr)',
        backgroundImage: textured ? `url(${skin.texture})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {cells.map((d, i) => (
        <div
          key={i}
          style={{
            background: textured
              ? d
                ? 'rgba(0,0,0,0.30)'
                : 'rgba(255,255,255,0.06)'
              : d
                ? skin.dark
                : skin.light,
          }}
        />
      ))}
    </div>
  )
}

function BackPreview({ skin }: { skin: ImageSkin }) {
  return (
    <div className="flex items-center justify-center bg-bg py-3">
      <img
        src={skin.src}
        alt=""
        className="h-[104px] w-[74px] rounded-lg object-cover shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
      />
    </div>
  )
}

function FeltPreview({ skin }: { skin: ImageSkin }) {
  return (
    <div className="h-[112px] w-full overflow-hidden">
      <img src={skin.src} alt="" className="h-full w-full object-cover" />
    </div>
  )
}

function CheckerPreview({ skin }: { skin: CheckerSkin }) {
  return (
    <div
      className="flex items-center justify-center gap-3 py-4"
      style={{ background: '#9c7b52' }}
    >
      <img src={skin.light} alt="" className="h-16 w-16 drop-shadow" />
      <img src={skin.dark} alt="" className="h-16 w-16 drop-shadow" />
    </div>
  )
}

function SkinCard({
  name,
  price,
  owned,
  equipped,
  preview,
  onBuy,
  onEquip,
}: {
  name: string
  price: number
  owned: boolean
  equipped: boolean
  preview: React.ReactNode
  onBuy: () => void
  onEquip: () => void
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line/60 bg-surface shadow-[var(--shadow-soft)]">
      <div className="overflow-hidden">{preview}</div>
      <div className="space-y-2 p-3">
        <p className="truncate text-center font-bold leading-tight">{name}</p>
        {equipped ? (
          <div className="flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-btn)] bg-gold-light/50 text-sm font-bold text-gold-dark">
            <Check size={16} strokeWidth={2.5} /> Выбрано
          </div>
        ) : owned ? (
          <Button size="sm" variant="secondary" className="w-full" onClick={onEquip}>
            Выбрать
          </Button>
        ) : (
          <Button size="sm" className="w-full" onClick={onBuy}>
            <PriceTag stars={price} />
          </Button>
        )}
      </div>
    </div>
  )
}

export function Store() {
  const [, setRev] = useState(0)
  const refresh = () => setRev((v) => v + 1)
  // Purchase window: item awaiting confirmation (paid in Telegram Stars).
  const [pending, setPending] = useState<{ title: string; stars: number; confirm: () => void } | null>(null)
  const buyFlow = (title: string, stars: number, confirm: () => void) =>
    setPending({ title, stars, confirm })
  const confirmPurchase = () => {
    pending?.confirm()
    setPending(null)
    refresh()
  }
  const equippedPiece = getEquippedPieceId()
  const equippedBoardId = getEquippedBoardId()
  const equippedBack = getEquippedBackId()
  const equippedFelt = getEquippedFeltId()
  const equippedChecker = getEquippedCheckerId()
  const vip = isVip()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Магазин</h1>
        <StarBalance amount={player.balance} />
      </div>

      {/* Premium VIP — whole banner is the buy button (opens the purchase window) */}
      <button
        disabled={vip}
        onClick={() => buyFlow('VIP статус', VIP_PRICE_STARS, buyVip)}
        className="relative block w-full overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-soft)] transition active:scale-[0.99] disabled:active:scale-100"
      >
        <img
          src="/assets/vip-banner.jpg"
          alt="VIP статус — больше возможностей"
          className="block w-full"
        />
        {vip && (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-gradient-to-b from-gold to-gold-dark px-3 py-1 text-xs font-bold text-white shadow">
            <Check size={13} strokeWidth={2.5} /> Вы VIP
          </span>
        )}
      </button>

      <section>
        <SectionHeader title="Фигуры · Шахматы" />
        <div className="grid grid-cols-2 gap-3">
          {PIECE_SKINS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={skin.name}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedPiece === skin.id}
              preview={<PiecePreview skin={skin} />}
              onBuy={() =>
                buyFlow(skin.name, skin.price, () => {
                  buy(skin.id)
                  equipPiece(skin.id)
                })
              }
              onEquip={() => {
                equipPiece(skin.id)
                refresh()
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Доски · Шахматы" />
        <div className="grid grid-cols-2 gap-3">
          {BOARD_SKINS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={skin.name}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedBoardId === skin.id}
              preview={<BoardPreview skin={skin} />}
              onBuy={() =>
                buyFlow(skin.name, skin.price, () => {
                  buy(skin.id)
                  equipBoard(skin.id)
                })
              }
              onEquip={() => {
                equipBoard(skin.id)
                refresh()
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Рубашки · Дурак" />
        <div className="grid grid-cols-2 gap-3">
          {DURAK_BACKS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={skin.name}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedBack === skin.id}
              preview={<BackPreview skin={skin} />}
              onBuy={() =>
                buyFlow(skin.name, skin.price, () => {
                  buy(skin.id)
                  equipDurakBack(skin.id)
                })
              }
              onEquip={() => {
                equipDurakBack(skin.id)
                refresh()
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Полотна · Дурак" />
        <div className="grid grid-cols-2 gap-3">
          {DURAK_FELTS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={skin.name}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedFelt === skin.id}
              preview={<FeltPreview skin={skin} />}
              onBuy={() =>
                buyFlow(skin.name, skin.price, () => {
                  buy(skin.id)
                  equipDurakFelt(skin.id)
                })
              }
              onEquip={() => {
                equipDurakFelt(skin.id)
                refresh()
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Фишки · Нарды" />
        <div className="grid grid-cols-2 gap-3">
          {NARDY_CHECKERS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={skin.name}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedChecker === skin.id}
              preview={<CheckerPreview skin={skin} />}
              onBuy={() =>
                buyFlow(skin.name, skin.price, () => {
                  buy(skin.id)
                  equipChecker(skin.id)
                })
              }
              onEquip={() => {
                equipChecker(skin.id)
                refresh()
              }}
            />
          ))}
        </div>
      </section>

      {/* purchase window — pay in Telegram Stars */}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={() => setPending(null)}
        >
          <div
            className="w-full max-w-xs rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-soft)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold-light/60 text-gold-dark">
              <Star size={26} className="fill-current" />
            </div>
            <p className="mt-3 text-lg font-extrabold">Покупка</p>
            <p className="mt-1 text-sm text-muted">{pending.title}</p>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-3xl font-extrabold">
              <Star size={24} className="fill-gold text-gold" />
              {pending.stars.toLocaleString('ru-RU')}
            </div>
            <p className="mt-1 text-xs text-muted">Оплата звёздами Telegram</p>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setPending(null)}>
                Отмена
              </Button>
              <Button className="flex-1" onClick={confirmPurchase}>
                Купить за <PriceTag stars={pending.stars} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
