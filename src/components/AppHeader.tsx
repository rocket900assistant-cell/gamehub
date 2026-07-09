import { Star } from 'lucide-react'
import { t } from '../lib/i18n'

/** Brand header shown at the top of the home tab. */
export function AppHeader() {
  return (
    <header>
      <div className="flex items-center gap-1.5">
        <h1 className="text-xl font-extrabold tracking-tight">
          GameHub <span className="text-muted font-bold">- Online</span>
        </h1>
        <Star size={16} className="fill-gold text-gold" />
      </div>
      <p className="mt-0.5 text-sm text-muted">{t('header.tagline')}</p>
    </header>
  )
}
