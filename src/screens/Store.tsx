import { useState } from 'react'
import { Crown, Spade } from 'lucide-react'
import { StarBalance } from '../components/ui/StarBalance'
import { SectionHeader } from '../components/ui/SectionHeader'
import { ProductCard } from '../components/ProductCard'
import { Button } from '../components/ui/Button'
import { cardDecks, player, shopTabs, vipTiers } from '../data/mock'
import { cn } from '../lib/cn'

export function Store() {
  const [tab, setTab] = useState<(typeof shopTabs)[number]>('Популярное')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Магазин</h1>
        <StarBalance amount={player.balance} />
      </div>

      {/* Premium VIP banner (dark + gold) */}
      <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br from-ink to-ink/85 p-5 text-white shadow-[var(--shadow-soft)]">
        <div className="relative z-10 max-w-[70%]">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold">
            Premium статус
          </p>
          <ul className="mt-2 space-y-1 text-sm text-white/80">
            <li>★ Эксклюзивные скины</li>
            <li>★ Символ и подсветка ника</li>
            <li>★ Больше возможностей</li>
          </ul>
          <Button className="mt-4" size="sm">
            Подробнее
          </Button>
        </div>
        <Crown
          size={72}
          className="absolute -right-1 top-1/2 -translate-y-1/2 text-gold/80"
          strokeWidth={1.2}
        />
      </div>

      {/* Tabs */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {shopTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition',
              tab === t
                ? 'bg-gold text-white'
                : 'bg-surface text-muted border border-line',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <section>
        <SectionHeader title="Колоды карт" actionLabel="Смотреть все" />
        <div className="grid grid-cols-2 gap-3">
          {cardDecks.map((item) => (
            <ProductCard key={item.id} item={item} icon={Spade} onBuy={() => {}} />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="VIP статус" actionLabel="Смотреть все" />
        <div className="grid grid-cols-2 gap-3">
          {vipTiers.map((item) => (
            <ProductCard key={item.id} item={item} onBuy={() => {}} />
          ))}
        </div>
      </section>
    </div>
  )
}
