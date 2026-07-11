import { useEffect, useRef, useState } from 'react'

/** Animates a whole number from 0 → `to` (easeOutCubic). Respects reduced motion. */
export function CountUp({ to, duration = 650 }: { to: number; duration?: number }) {
  const [n, setN] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setN(to)
      return
    }
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(to * eased))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [to, duration])
  return <>{n}</>
}
