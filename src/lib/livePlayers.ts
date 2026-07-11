import { useEffect, useState } from 'react'

// A cosmetic "players now" counter for the home screen: each game shows a number
// that keeps drifting randomly within [MIN, MAX] so the hub always looks lively.
// Purely presentational — not tied to real presence.
const MIN = 100
const MAX = 1500
const STEP = 60 // max change per tick — small, so it reads as natural fluctuation
const TICK_MS = 60000 // update once a minute (calm, not distracting)

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n))

const counts: Record<string, number> = {}
for (const id of ['durak', 'chess', 'nardy', 'durakn']) counts[id] = Math.round(rnd(MIN, MAX))

const subs = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function tick() {
  for (const id in counts) counts[id] = Math.round(clamp(counts[id] + rnd(-STEP, STEP)))
  subs.forEach((f) => f())
}

/** Subscribe a component to the shared drifting counters. */
function useLiveStore() {
  const [, force] = useState(0)
  useEffect(() => {
    if (!timer) timer = setInterval(tick, TICK_MS)
    const f = () => force((x) => x + 1)
    subs.add(f)
    return () => {
      subs.delete(f)
      if (subs.size === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [])
}

/** The whole live-count map, for lists rendered with `.map`. Re-renders on each tick. */
export function useLivePlayers(): Record<string, number> {
  useLiveStore()
  return counts
}

/** Live "players now" count for a single game id. */
export function useLiveCount(id: string): number {
  useLiveStore()
  if (counts[id] == null) counts[id] = Math.round(rnd(MIN, MAX))
  return counts[id]
}
