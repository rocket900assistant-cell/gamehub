import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, ArrowUp, Plus, Gem, Wallet as WalletIcon, Copy, X, Check } from 'lucide-react'
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
  onBack: () => void
}

export function Wallet({ balance, address, onBack }: WalletProps) {
  const [history, setHistory] = useState<GramTx[] | null>(null)
  const [notice, setNotice] = useState('')
  const [deposit, setDeposit] = useState<{ address: string; tag: string; qr: string } | null>(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    const s = getSocket()
    const onHistory = (p: { items: GramTx[] }) => setHistory(p.items ?? [])
    s.on('gram:history', onHistory)
    s.emit('gram:history')
    return () => {
      s.off('gram:history', onHistory)
    }
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
  const onWithdraw = () => setNotice(t('wallet.soon'))

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

      {/* balance card */}
      <div className="relative overflow-hidden rounded-[var(--radius-card)] p-5 text-white shadow-[var(--shadow-soft)]"
        style={{ background: 'linear-gradient(150deg,#2f6bd6,#1f3f86)' }}>
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute right-6 top-8 h-28 w-28 rounded-full bg-white/10" />

        <div className="relative flex items-center gap-1.5 text-sm text-white/80">
          <WalletIcon size={14} />
          {address ? (
            <span className="font-mono">{address.slice(0, 4)}…{address.slice(-4)}</span>
          ) : (
            <span>{t('wallet.notConnected')}</span>
          )}
        </div>

        <div className="relative mt-3 flex items-end gap-2">
          <span className="text-4xl font-extrabold tabular-nums leading-none">{fmt(balance)}</span>
          <span className="mb-0.5 text-lg font-bold text-white/80">GRAM</span>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={onDeposit}
            className="flex items-center justify-center gap-2 rounded-2xl bg-white py-3 font-bold text-[#1f3f86] transition active:scale-[0.98]"
          >
            <Plus size={18} strokeWidth={2.5} /> {t('wallet.deposit')}
          </button>
          <button
            onClick={onWithdraw}
            className="flex items-center justify-center gap-2 rounded-2xl bg-white/15 py-3 font-bold text-white backdrop-blur transition active:scale-[0.98]"
          >
            <ArrowUp size={18} strokeWidth={2.5} /> {t('wallet.withdraw')}
          </button>
        </div>
      </div>

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
