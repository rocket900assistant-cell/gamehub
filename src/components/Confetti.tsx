const COLORS = ['#D99A2B', '#B97817', '#23C55E', '#FFFFFF', '#F1E3C6']

/** Lightweight CSS confetti burst (used on a win). */
export function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {Array.from({ length: 40 }).map((_, i) => {
        const size = 6 + Math.random() * 7
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${Math.random() * 100}%`,
              top: '-6vh',
              width: size,
              height: size * 0.6,
              background: COLORS[i % COLORS.length],
              borderRadius: 2,
              animation: `gh-confetti ${1.1 + Math.random() * 0.9}s ${
                Math.random() * 0.5
              }s ease-in forwards`,
            }}
          />
        )
      })}
    </div>
  )
}
