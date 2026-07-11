import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, ArrowUp, Plus, Gem, Wallet as WalletIcon, Copy, X, Check } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { getSocket } from '../lib/socket'
import { t } from '../lib/i18n'

interface GramTx {
  kind: 'deposit' | 'withdraw' | 'stake' | 'win' | 'refund' | string
  amount: number
  status: string
  ref?: string | null
  at: string
}

const KIND_LABEL: Record<string, string> = {
  deposit: 'Пополнение',
  withdraw: 'Вывод',
  stake: 'Ставка',
  win: 'Выигрыш',
  refund: 'Возврат',
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
    ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

interface WalletProps {
  balance: number
  address?: string | null
  owner?: boolean
  onOpenAdmin?: () => void
  onBack: () => void
}

const round2 = (x: number) => Math.round(x * 100) / 100
const estFee = (amt: number) => (amt > 0 ? Math.max(round2(amt * 0.001), 0.05) : 0) // mirrors the server

export function Wallet({ balance, address, owner, onOpenAdmin, onBack }: WalletProps) {
  const [history, setHistory] = useState<GramTx[] | null>(null)
  const [notice, setNotice] = useState('')
  const [deposit, setDeposit] = useState<{ address: string; tag: string; qr: string } | null>(null)
  const [copied, setCopied] = useState('')
  const [wd, setWd] = useState(false) // withdraw sheet open
  const [wdAmount, setWdAmount] = useState('')
  const [wdAddr, setWdAddr] = useState('')
  const [wdErr, setWdErr] = useState('')
  const [wdBusy, setWdBusy] = useState(false)
  const [fee, setFee] = useState<{ accrued: number; hot: number | null } | null>(null)
  const [feeBusy, setFeeBusy] = useState(false)

  const loadFee = () => {
    if (!owner) return
    getSocket().emit('gram:fee:status', {}, (r: { accrued?: number; hot?: number | null }) =>
      setFee({ accrued: r?.accrued ?? 0, hot: r?.hot ?? null }),
    )
  }
  useEffect(loadFee, [owner])

  const withdrawFee = () => {
    setFeeBusy(true)
    getSocket().emit('gram:fee:withdraw', {}, (r: { ok?: boolean; sent?: number; error?: string }) => {
      setFeeBusy(false)
      setNotice(
        r?.ok
          ? `${t('admin.feeSent')} · ${r.sent} GRAM`
          : r?.error === 'no-hot'
            ? t('admin.feeNoHot')
            : r?.error === 'hot-low'
              ? t('admin.feeHotLow')
              : r?.error === 'empty'
                ? t('admin.feeEmpty')
                : t('admin.feeFail'),
      )
      loadFee()
    })
  }

  useEffect(() => {
    const s = getSocket()
    const onHistory = (p: { items: GramTx[] }) => setHistory(p.items ?? [])
    const onCredited = (p: { amount: number }) => {
      setDeposit(null)
      setNotice(`${t('wallet.credited')} +${p.amount} GRAM`)
      s.emit('gram:history') // refresh the list
    }
    const onSent = (p: { amount: number }) => {
      setNotice(`${t('wallet.wdSent')} · ${p.amount} GRAM`)
      s.emit('gram:history')
    }
    s.on('gram:history', onHistory)
    s.on('gram:credited', onCredited)
    s.on('gram:withdraw:sent', onSent)
    s.emit('gram:history')
    return () => {
      s.off('gram:history', onHistory)
      s.off('gram:credited', onCredited)
      s.off('gram:withdraw:sent', onSent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copy = (text: string, which: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(''), 1500)
    })
  }

  // Personal deposit: platform address + this user's tag, shown as a QR.
  const onDeposit = () => {
    getSocket().emit('gram:deposit', {}, async (res: { address?: string | null; tag?: string | null }) => {
      if (!res?.address || !res?.tag) {
        setNotice(t('wallet.soon'))
        return
      }
      const link = `ton://transfer/${res.address}?text=${encodeURIComponent(res.tag)}`
      const qr = await QRCode.toDataURL(link, { margin: 1, width: 320 })
      setDeposit({ address: res.address, tag: res.tag, qr })
    })
  }
  const onWithdraw = () => {
    setWdErr('')
    setWdAmount('')
    setWdAddr(address ?? '')
    setWd(true)
  }
  const submitWithdraw = () => {
    const amt = round2(parseFloat(wdAmount) || 0)
    if (amt < 1) return setWdErr(t('wallet.wdMin'))
    if (amt > balance) return setWdErr(t('stake.insufficient'))
    if (!/^[EU]Q[A-Za-z0-9_-]{46}$/.test(wdAddr.trim())) return setWdErr(t('wallet.wdBadAddr'))
    setWdBusy(true)
    getSocket().emit(
      'gram:withdraw',
      { amount: amt, address: wdAddr.trim() },
      (res: { ok?: boolean; error?: string; payout?: number }) => {
        setWdBusy(false)
        if (res?.ok) {
          setWd(false)
          setNotice(`${t('wallet.wdRequested')} · ${res.payout} GRAM`)
          getSocket().emit('gram:history')
        } else {
          setWdErr(res?.error === 'balance' ? t('stake.insufficient') : res?.error === 'address' ? t('wallet.wdBadAddr') : t('wallet.wdMin'))
        }
      },
    )
  }

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
        <h1 className="text-2xl font-extrabold">{t('wallet.title')}</h1>
      </div>

      {/* balance card — warm cream / soft gold */}
      <div
        className="relative overflow-hidden rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-soft)]"
        style={{ background: 'linear-gradient(155deg,#f6ecd4,#e8d5a8)', color: '#4a3d1e' }}
      >
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/35" />
        <div className="pointer-events-none absolute right-6 top-8 h-28 w-28 rounded-full bg-white/30" />

        <div className="relative flex items-center gap-1.5 text-sm" style={{ color: '#4a3d1eaa' }}>
          <WalletIcon size={14} />
          {address ? (
            <span className="font-mono">{address.slice(0, 4)}…{address.slice(-4)}</span>
          ) : (
            <span>{t('wallet.notConnected')}</span>
          )}
        </div>

        <div className="relative mt-3 flex items-end gap-2">
          <span className="text-4xl font-extrabold tabular-nums leading-none" style={{ color: '#2a2210' }}>
            {fmt(balance)}
          </span>
          <span className="mb-0.5 text-lg font-bold" style={{ color: '#4a3d1eaa' }}>GRAM</span>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={onDeposit}
            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-gold to-gold-dark py-3 font-bold text-white shadow-[var(--shadow-gold)] transition active:scale-[0.98]"
          >
            <Plus size={18} strokeWidth={2.5} /> {t('wallet.deposit')}
          </button>
          <button
            onClick={onWithdraw}
            className="flex items-center justify-center gap-2 rounded-2xl bg-white/60 py-3 font-bold transition active:scale-[0.98]"
            style={{ color: '#4a3d1e' }}
          >
            <ArrowUp size={18} strokeWidth={2.5} /> {t('wallet.withdraw')}
          </button>
        </div>
      </div>

      {owner && (
        <div className="space-y-2">
          <Button variant="secondary" className="w-full" onClick={onOpenAdmin}>
            {t('wallet.requests')}
          </Button>
          {/* accrued owner fee + withdraw to FEE_TON_ADDRESS */}
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {t('admin.feeAccrued')}
                </p>
                <div className="mt-1 flex items-end gap-1.5">
                  <span className="text-2xl font-extrabold tabular-nums">
                    {(fee?.accrued ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                  </span>
                  <span className="mb-0.5 text-sm font-bold text-muted">GRAM</span>
                </div>
              </div>
              <Gem size={24} className="mb-1 text-gold" />
            </div>
            {fee?.hot != null && (
              <p className="mt-1 text-xs text-muted">
                {t('admin.hotBalance')}: {fee.hot} GRAM
              </p>
            )}
            <Button
              className="mt-3 w-full"
              disabled={feeBusy || (fee?.accrued ?? 0) <= 0}
              onClick={withdrawFee}
            >
              {t('admin.feeWithdraw')}
            </Button>
          </div>
        </div>
      )}

      {/* history */}
      <section>
        <h2 className="mb-2 text-lg font-extrabold">{t('wallet.history')}</h2>
        {history == null ? (
          <p className="py-8 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : history.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 py-10 text-center">
            <p className="font-bold">{t('wallet.empty')}</p>
            <p className="mt-1 text-sm text-muted">{t('wallet.emptyHint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((tx, i) => {
              const positive = tx.amount >= 0
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 shadow-[var(--shadow-soft)]">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${positive ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger'}`}>
                    {positive ? <Plus size={16} strokeWidth={2.5} /> : <ArrowUp size={16} strokeWidth={2.5} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold leading-tight">{KIND_LABEL[tx.kind] ?? tx.kind}</p>
                    <p className="text-xs text-muted">
                      {fmtDate(tx.at)}
                      {tx.status === 'pending' && ` · ${t('wallet.pending')}`}
                    </p>
                  </div>
                  <span className={`shrink-0 font-extrabold tabular-nums ${positive ? 'text-success' : 'text-danger'}`}>
                    {positive ? '+' : '−'}{fmt(Math.abs(tx.amount))}
                    <Gem size={11} className="ml-1 inline text-gold" />
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* deposit sheet — personal QR + address + tag */}
      {deposit && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45" onClick={() => setDeposit(null)}>
          <div
            className="mx-auto w-full max-w-md rounded-t-[24px] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-extrabold">{t('wallet.depositTitle')}</p>
              <button onClick={() => setDeposit(null)} aria-label="Закрыть">
                <X size={20} className="text-muted" />
              </button>
            </div>

            <div className="mx-auto w-fit rounded-2xl bg-white p-3">
              <img src={deposit.qr} alt="QR" className="h-48 w-48" />
            </div>

            <p className="mt-3 text-center text-sm text-muted">{t('wallet.depositHint')}</p>

            <div className="mt-4 space-y-2">
              <CopyRow label={t('wallet.address')} value={deposit.address} copied={copied === 'addr'} onCopy={() => copy(deposit.address, 'addr')} />
              <CopyRow label={t('wallet.comment')} value={deposit.tag} copied={copied === 'tag'} onCopy={() => copy(deposit.tag, 'tag')} />
            </div>

            <p className="mt-3 text-center text-xs text-danger">{t('wallet.commentWarn')}</p>
          </div>
        </div>
      )}

      {/* withdraw sheet */}
      {wd && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45" onClick={() => setWd(false)}>
          <div
            className="mx-auto w-full max-w-md rounded-t-[24px] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-extrabold">{t('wallet.withdraw')}</p>
              <button onClick={() => setWd(false)} aria-label="Закрыть">
                <X size={20} className="text-muted" />
              </button>
            </div>

            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {t('wallet.wdAmount')} · {t('wallet.available')} {balance} GRAM
            </label>
            <input
              value={wdAmount}
              onChange={(e) => setWdAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0"
              className="mt-1 h-12 w-full rounded-[var(--radius-input)] border border-line bg-bg px-3 text-lg font-bold outline-none"
            />
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              {t('wallet.wdAddress')}
            </label>
            <input
              value={wdAddr}
              onChange={(e) => setWdAddr(e.target.value)}
              placeholder="UQ… / EQ…"
              className="mt-1 h-12 w-full rounded-[var(--radius-input)] border border-line bg-bg px-3 font-mono text-sm outline-none"
            />

            {(() => {
              const amt = round2(parseFloat(wdAmount) || 0)
              const fee = estFee(amt)
              const net = amt > 0 ? round2(amt - fee) : 0
              return amt > 0 ? (
                <div className="mt-3 space-y-1 rounded-xl bg-bg p-3 text-sm">
                  <div className="flex justify-between text-muted">
                    <span>{t('wallet.wdFee')} (0.1%)</span>
                    <span>−{fee} GRAM</span>
                  </div>
                  <div className="flex justify-between font-extrabold">
                    <span>{t('wallet.wdReceive')}</span>
                    <span>{net} GRAM</span>
                  </div>
                </div>
              ) : null
            })()}

            {wdErr && <p className="mt-2 text-sm font-semibold text-danger">{wdErr}</p>}

            <Button className="mt-4 w-full" size="lg" disabled={wdBusy} onClick={submitWithdraw}>
              {t('wallet.withdraw')}
            </Button>
            <p className="mt-2 text-center text-xs text-muted">{t('wallet.wdReview')}</p>
          </div>
        </div>
      )}

      {notice && (
        <div
          className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[90%] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg shadow-lg"
          onClick={() => setNotice('')}
        >
          {notice}
        </div>
      )}
    </div>
  )
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <button
      onClick={onCopy}
      className="flex w-full items-center gap-3 rounded-xl bg-bg px-3 py-2.5 text-left transition active:scale-[0.99]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate font-mono text-sm">{value}</p>
      </div>
      {copied ? (
        <Check size={17} className="shrink-0 text-success" />
      ) : (
        <Copy size={16} className="shrink-0 text-muted" />
      )}
    </button>
  )
}
