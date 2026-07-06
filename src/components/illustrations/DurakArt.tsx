interface ArtProps {
  className?: string
}

/** Stylized fan of playing cards (stand-in illustration for Дурак). */
export function DurakArt({ className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 240 130"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="durakCard" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#FBF3E0" />
        </linearGradient>
      </defs>

      {/* back cards of the fan */}
      <g transform="translate(150 30) rotate(20)">
        <rect width="62" height="88" rx="9" fill="url(#durakCard)" stroke="#EAD9AE" />
        <text x="10" y="24" fontSize="18" fill="#E45A5A" fontWeight="700">
          ♥
        </text>
      </g>
      <g transform="translate(118 20) rotate(9)">
        <rect width="62" height="88" rx="9" fill="url(#durakCard)" stroke="#EAD9AE" />
        <text x="10" y="24" fontSize="18" fill="#E45A5A" fontWeight="700">
          ♦
        </text>
      </g>

      {/* front card: Ace of Spades */}
      <g transform="translate(84 14) rotate(-6)">
        <rect
          width="66"
          height="94"
          rx="10"
          fill="url(#durakCard)"
          stroke="#D8A93E"
          strokeWidth="1.5"
        />
        <text x="11" y="26" fontSize="17" fill="#181818" fontWeight="800">
          A
        </text>
        <text
          x="33"
          y="58"
          fontSize="34"
          fill="#181818"
          fontWeight="700"
          textAnchor="middle"
        >
          ♠
        </text>
        <text
          x="55"
          y="86"
          fontSize="17"
          fill="#181818"
          fontWeight="800"
          transform="rotate(180 55 80)"
        >
          A
        </text>
      </g>
    </svg>
  )
}
