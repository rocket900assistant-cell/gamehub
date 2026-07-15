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

interface WdHist {
  id: number
  name?: string
  username?: string
  amount: number
  status: string
  address?: string | null
  payout: number
  at: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Отправлено', cls: 'text-success' },
  approved: { label: 'В отправке', cls: 'text-gold-dark' },
  sending: { label: 'В отправке', cls: 'text-gold-dark' },
  rejected: { label: 'Отклонено', cls: 'text-danger' },
}
const shortAddr = (a?: string | null) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '')
const histDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function WithdrawAdmin({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<WdReq[] | null>(null)
  const [history, setHistory] = useState<WdHist[]>([])
  const [busy, setBusy] = useState<number | null>(null)

  const refresh = () => {
    getSocket().emit('gram:withdrawals', {}, (r: { items?: WdReq[] }) => setItems(r?.items ?? []))
    getSocket().emit('gram:withdrawals:history', {}, (r: { items?: WdHist[] }) => setHistory(r?.items ?? []))
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

      {/* history of processed requests */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">История заявок</p>
          <div className="divide-y divide-line/70 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-soft)]">
            {history.map((w) => {
              const st = STATUS[w.status] ?? { label: w.status, cls: 'text-muted' }
              return (
                <div key={w.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold leading-tight">
                      {w.name ?? (w.username ? `@${w.username}` : `id ${w.id}`)}
                    </p>
                    <p className="text-[11px] text-muted">
                      {histDate(w.at)}
                      {w.address ? ` · → ${shortAddr(w.address)}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="flex items-center justify-end gap-1 font-extrabold tabular-nums">
                      {w.amount}
                      <Gem size={11} className="text-gold" />
                    </p>
                    <p className={`text-[11px] font-bold ${st.cls}`}>{st.label}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
