interface EloChartProps {
  points: number[]
  className?: string
}

/** Simple gold sparkline for the Elo trend. */
export function EloChart({ points, className }: EloChartProps) {
  const w = 300
  const h = 72
  const pad = 6
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const step = w / (points.length - 1)

  const coords = points.map((p, i) => {
    const x = i * step
    const y = h - pad - ((p - min) / range) * (h - pad * 2)
    return [x, y] as const
  })

  const line = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`
  const [ex, ey] = coords[coords.length - 1]

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="eloFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5C542" stopOpacity="0.28" />
          <stop offset="1" stopColor="#F5C542" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#eloFill)" />
      <path
        d={line}
        stroke="#E8A923"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={ex} cy={ey} r="4.5" fill="#E8A923" stroke="#fff" strokeWidth="2" />
    </svg>
  )
}
