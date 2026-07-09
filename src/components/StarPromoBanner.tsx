import { Send } from 'lucide-react'
import { t } from '../lib/i18n'
import { openStarsBot } from '../lib/telegram'

/** Compact one-line promo: buy stars 30% cheaper via the external bot. */
export function StarPromoBanner() {
  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-line bg-surface p-2.5 shadow-[var(--shadow-soft)]">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2AABEE] text-white">
        <Send size={17} className="-ml-0.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-bold leading-tight">
          {t('promo.buyGram')}
        </p>
        <p className="truncate text-[10px] text-muted">
          {t('promo.buyGramHint')}
        </p>
      </div>
      <button
        onClick={openStarsBot}
        className="shrink-0 rounded-[var(--radius-btn)] bg-gradient-to-b from-gold to-gold-dark px-3 py-2 text-[12px] font-bold text-white shadow-[var(--shadow-gold)] transition active:scale-95"
      >
        {t('promo.buy')}
      </button>
    </div>
  )
}
