interface ArtProps {
  className?: string
}

/** Gold star with coins — illustration for the "buy stars" promo. */
export function GoldStar({ className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 140 140"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="gsStar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FCE9B8" />
          <stop offset="0.5" stopColor="#E8B94A" />
          <stop offset="1" stopColor="#B8862A" />
        </linearGradient>
        <linearGradient id="gsCoin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F3D583" />
          <stop offset="1" stopColor="#C79429" />
        </linearGradient>
      </defs>

      {/* coins */}
      <g stroke="#A9781F" strokeWidth="1">
        <ellipse cx="42" cy="116" rx="26" ry="9" fill="url(#gsCoin)" />
        <ellipse cx="42" cy="109" rx="26" ry="9" fill="url(#gsCoin)" />
        <ellipse cx="105" cy="120" rx="22" ry="8" fill="url(#gsCoin)" />
        <ellipse cx="105" cy="114" rx="22" ry="8" fill="url(#gsCoin)" />
      </g>

      {/* small sparkle stars */}
      <path d="M28 34 l4 9 l9 4 l-9 4 l-4 9 l-4 -9 l-9 -4 l9 -4 z" fill="#EFC868" />
      <path d="M120 54 l3 6 l6 3 l-6 3 l-3 6 l-3 -6 l-6 -3 l6 -3 z" fill="#EFC868" />

      {/* main star */}
      <path
        d="M70 14 L85 52 L126 54 L94 80 L104 120 L70 96 L36 120 L46 80 L14 54 L55 52 Z"
        fill="url(#gsStar)"
        stroke="#A9781F"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* highlight facet */}
      <path d="M70 14 L85 52 L70 62 Z" fill="#FCEFCB" opacity="0.6" />
    </svg>
  )
}
