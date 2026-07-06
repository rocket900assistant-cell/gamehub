import { Crown, Gem, Layers } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ShopItem } from '../data/mock'
import { Card } from './ui/Card'
import { AssetPlaceholder } from './ui/AssetPlaceholder'
import { cn } from '../lib/cn'

const tierStyles: Record<ShopItem['tier'], string> = {
  common: 'bg-line text-muted',
  rare: 'bg-success/15 text-success',
  epic: 'bg-gold-light/50 text-gold',
  legendary: 'bg-gold text-white',
}

interface ProductCardProps {
  item: ShopItem
  icon?: LucideIcon
  onBuy: (item: ShopItem) => void
}

export function ProductCard({ item, icon = Layers, onBuy }: ProductCardProps) {
  const isVip = item.category.includes('VIP')
  return (
    <button onClick={() => onBuy(item)} className="text-left">
      <Card flush className="transition active:scale-[0.98]">
        <div className="relative">
          <AssetPlaceholder
            icon={isVip ? Crown : icon}
            iconSize={40}
            gradient={
              isVip ? 'from-ink to-ink/80' : 'from-gold-light/60 to-gold/25'
            }
            className={cn('h-24 w-full rounded-none', isVip && 'text-gold')}
          />
          <span
            className={cn(
              'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold capitalize',
              tierStyles[item.tier],
            )}
          >
            {item.tier}
          </span>
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-bold">{item.name}</p>
          <p className="mt-1 flex items-center gap-1 text-sm font-bold text-ink">
            {item.price.toLocaleString('ru-RU')}
            <Gem size={13} className="text-gold" />
          </p>
        </div>
      </Card>
    </button>
  )
}
