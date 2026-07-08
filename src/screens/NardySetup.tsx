import { useState } from 'react'
import { ArrowLeft, Bot, Swords, UserPlus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { GameTypeToggle, StakeStepper, MIN_STAKE } from '../components/StakePicker'

export interface NardyConfig {
  free: boolean
  stake: number
}

interface NardySetupProps {
  onBack: () => void
  onCreate: (cfg: NardyConfig) => void
  onQuickMatch: () => void
  onInvite: () => void
}

export function NardySetup({ onBack, onCreate, onQuickMatch, onInvite }: NardySetupProps) {
  const [free, setFree] = useState(true)
  const [stakeText, setStakeText] = useState('0.1')
  const num = parseFloat(stakeText) || 0

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Назад"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-2xl font-extrabold">Нарды</h1>
      </div>

      <GameTypeToggle free={free} onChange={setFree} />
      {!free && <StakeStepper value={stakeText} onChange={setStakeText} />}

      <p className="px-1 text-sm text-muted">Длинные нарды. 2 минуты на ход.</p>

      <div className="space-y-3">
        <Button size="lg" className="w-full" onClick={onQuickMatch}>
          <Swords size={18} /> Быстрая игра (онлайн)
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={onInvite}>
          <UserPlus size={18} /> Играть с другом
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="w-full"
          onClick={() => onCreate({ free, stake: free ? 0 : Math.max(MIN_STAKE, num) })}
        >
          <Bot size={18} /> Играть с ботом
        </Button>
      </div>
    </div>
  )
}
