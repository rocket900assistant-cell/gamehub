import { useEffect, useState } from 'react'
import { ArrowLeft, Check, X, Gem } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { getSocket } from '../lib/socket'
import { t } from '../lib/i18n'

interface WdReq {
  id: number
  tgId: number
  name?: string
  username?: string
  amount: number
  address: string
  fee: number
  payout: number
  at: string
}

export function WithdrawAdmin({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<WdReq[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [fee, setFee] = useState<{ accrued: number; feeAddress: string | null; hot: number | null } | null>(null)
  const [feeBusy, setFeeBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const refresh = () => {
    getSocket().emit('gram:withdrawals', {}, (r: { items?: WdReq[] }) => setItems(r?.items ?? []))
    getSocket().emit('gram:fee:status', {}, (r: { accrued?: number; feeAddress?: string | null; hot?: number | null }) =>
      setFee({ accrued: r?.accrued ?? 0, feeAddress: r?.feeAddress ?? null, hot: r?.hot ?? null }),
    )
  }
  useEffect(() => {
    const s = getSocket()
    const onList = (p: { items: WdReq[] }) => setItems(p.items ?? [])
    s.on('gram:withdrawals', onList)
    refresh()
    return () => {
      s.off('gram:withdrawals', onList)
    }
  }, [])

  const withdrawFee = () => {
    setFeeBusy(true)
    setNotice('')
    getSocket().emit('gram:fee:withdraw', {}, (r: { ok?: boolean; sent?: number; error?: string }) => {
      setFeeBusy(false)
      if (r?.ok) setNotice(`${t('admin.feeSent')} · ${r.sent} GRAM`)
      else
        setNotice(
          r?.error === 'no-hot'
            ? t('admin.feeNoHot')
            : r?.error === 'hot-low'
              ? t('admin.feeHotLow')
              : r?.error === 'empty'
                ? t('admin.feeEmpty')
                : r?.error === 'no-fee-address'
                  ? t('admin.feeNoAddr')
                  : t('admin.feeFail'),
        )
      refresh()
    })
  }

  const act = (id: number, event: 'gram:withdraw:approve' | 'gram:withdraw:reject') => {
    setBusy(id)
    getSocket().emit(event, { id }, () => {
      setBusy(null)
      refresh()
    })
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
        <h1 className="text-2xl font-extrabold">{t('admin.withdrawals')}</h1>
      </div>

      {/* accrued fee (owner profit) */}
      {fee && (
        <div
          className="rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-soft)]"
          style={{ background: 'linear-gradient(155deg,#f6ecd4,#e8d5a8)', color: '#4a3d1e' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#4a3d1eaa' }}>
            {t('admin.feeAccrued')}
          </p>
          <div className="mt-1 flex items-end gap-1.5">
            <span className="text-3xl font-extrabold tabular-nums" style={{ color: '#2a2210' }}>
              {fee.accrued.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
            </span>
            <span className="mb-0.5 font-bold" style={{ color: '#4a3d1eaa' }}>GRAM</span>
          </div>
          {fee.hot != null && (
            <p className="mt-1 text-xs" style={{ color: '#4a3d1eaa' }}>
              {t('admin.hotBalance')}: {fee.hot} GRAM
            </p>
          )}
          <Button
            className="mt-3 w-full"
            disabled={feeBusy || fee.accrued <= 0}
            onClick={withdrawFee}
          >
            {t('admin.feeWithdraw')}
          </Button>
        </div>
      )}

      {items == null ? (
        <p className="py-8 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 py-10 text-center">
          <p className="font-bold">{t('admin.noRequests')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((w) => (
            <div key={w.id} className="rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between">
                <p className="font-bold">{w.name ?? `id ${w.tgId}`}</p>
                <span className="flex items-center gap-1 font-extrabold tabular-nums">
                  {w.amount} <Gem size={12} className="text-gold" />
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-xs text-muted">{w.address}</p>
              <p className="mt-1 text-xs text-muted">
                {t('admin.toSend')}: <b className="text-ink">{w.payout} GRAM</b> · {t('wallet.wdFee')} {w.fee}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={busy === w.id}
                  onClick={() => act(w.id, 'gram:withdraw:approve')}
                >
                  <Check size={16} /> {t('admin.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  disabled={busy === w.id}
                  onClick={() => act(w.id, 'gram:withdraw:reject')}
                >
                  <X size={16} /> {t('admin.reject')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted">{t('admin.note')}</p>

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
