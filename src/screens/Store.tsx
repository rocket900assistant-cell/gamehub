import { useState } from 'react'
import { Check, Star } from 'lucide-react'
import { StarBalance } from '../components/ui/StarBalance'
import { SectionHeader } from '../components/ui/SectionHeader'
import { Button } from '../components/ui/Button'
import { setVip, getSocket } from '../lib/socket'
import { openStarsInvoice, haptic } from '../lib/telegram'
import { t, tf } from '../lib/i18n'
import {
  BOARD_SKINS,
  DURAK_BACKS,
  DURAK_FELTS,
  NARDY_CHECKERS,
  PIECE_SKINS,
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
            <Check size={16} strokeWidth={2.5} /> {t('common.chosen')}
          </div>
        ) : owned ? (
          <Button size="sm" variant="secondary" className="w-full" onClick={onEquip}>
            {t('common.choose')}
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

export function Store({ balance, onOpenWallet }: { balance: number; onOpenWallet?: () => void }) {
  const [, setRev] = useState(0)
  const refresh = () => setRev((v) => v + 1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Real Telegram Stars purchase: server makes an invoice → native pay sheet →
  // on success the server grants the item; we also apply it locally right away.
  const purchase = (product: string, grantLocal: () => void) => {
    if (busy) return
    setErr('')
    setBusy(true)
    getSocket().emit('shop:buy', { product }, (res: { link?: string; error?: string }) => {
      if (!res?.link) {
        setBusy(false)
        setErr(t('store.buyError'))
        return
      }
      openStarsInvoice(res.link).then((status) => {
        setBusy(false)
        if (status === 'paid') {
          haptic('success')
          grantLocal()
          refresh()
        } else if (status === 'failed') {
          setErr(t('store.buyError'))
        }
      })
    })
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
        <h1 className="text-2xl font-extrabold">{t('store.title')}</h1>
        <StarBalance amount={balance} onTopUp={onOpenWallet} />
      </div>

      {/* Premium VIP — whole banner is the buy button (opens the purchase window) */}
      <button
        disabled={vip}
        onClick={() =>
          purchase('vip', () => {
            buyVip()
            setVip()
          })
        }
        className="relative block w-full overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-soft)] transition active:scale-[0.99] disabled:active:scale-100"
      >
        <img
          src="/assets/vip-banner.jpg"
          alt="VIP статус — больше возможностей"
          className="block w-full"
        />
        {vip && (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-gradient-to-b from-gold to-gold-dark px-3 py-1 text-xs font-bold text-white shadow">
            <Check size={13} strokeWidth={2.5} /> {t('store.youVip')}
          </span>
        )}
      </button>

      <section>
        <SectionHeader title={t('store.piecesChess')} />
        <div className="grid grid-cols-2 gap-3">
          {PIECE_SKINS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={tf(`skin.${skin.id}`, skin.name)}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedPiece === skin.id}
              preview={<PiecePreview skin={skin} />}
              onBuy={() =>
                purchase('skin:' + skin.id, () => {
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
        <SectionHeader title={t('store.boardsChess')} />
        <div className="grid grid-cols-2 gap-3">
          {BOARD_SKINS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={tf(`skin.${skin.id}`, skin.name)}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedBoardId === skin.id}
              preview={<BoardPreview skin={skin} />}
              onBuy={() =>
                purchase('skin:' + skin.id, () => {
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
        <SectionHeader title={t('store.backsDurak')} />
        <div className="grid grid-cols-2 gap-3">
          {DURAK_BACKS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={tf(`skin.${skin.id}`, skin.name)}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedBack === skin.id}
              preview={<BackPreview skin={skin} />}
              onBuy={() =>
                purchase('skin:' + skin.id, () => {
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
        <SectionHeader title={t('store.feltsDurak')} />
        <div className="grid grid-cols-2 gap-3">
          {DURAK_FELTS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={tf(`skin.${skin.id}`, skin.name)}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedFelt === skin.id}
              preview={<FeltPreview skin={skin} />}
              onBuy={() =>
                purchase('skin:' + skin.id, () => {
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
        <SectionHeader title={t('store.checkersNardy')} />
        <div className="grid grid-cols-2 gap-3">
          {NARDY_CHECKERS.map((skin) => (
            <SkinCard
              key={skin.id}
              name={tf(`skin.${skin.id}`, skin.name)}
              price={skin.price}
              owned={isOwned(skin.id)}
              equipped={equippedChecker === skin.id}
              preview={<CheckerPreview skin={skin} />}
              onBuy={() =>
                purchase('skin:' + skin.id, () => {
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

      {/* purchase feedback toasts */}
      {err && (
        <div
          className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90%] rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white shadow-lg"
          onClick={() => setErr('')}
        >
          {err}
        </div>
      )}
    </div>
  )
}
