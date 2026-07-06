interface ArtProps {
  className?: string
}

/** Stylized gold chess pieces (stand-in illustration for Шахматы). */
export function ChessArt({ className }: ArtProps) {
  return (
    <svg
      viewBox="0 0 240 130"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="chessGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5D99A" />
          <stop offset="0.55" stopColor="#D8A93E" />
          <stop offset="1" stopColor="#B8862A" />
        </linearGradient>
      </defs>

      <g fill="url(#chessGold)" stroke="#A9781F" strokeWidth="1" strokeLinejoin="round">
        {/* shadows */}
        <ellipse cx="64" cy="107" rx="24" ry="5" fill="#00000012" stroke="none" />
        <ellipse cx="120" cy="109" rx="28" ry="6" fill="#00000012" stroke="none" />
        <ellipse cx="178" cy="107" rx="20" ry="5" fill="#00000012" stroke="none" />

        {/* Rook (left) */}
        <g transform="translate(64 0)">
          <rect x="-16" y="96" width="32" height="10" rx="3" />
          <path d="M-11 96 L-9 58 L9 58 L11 96 Z" />
          <rect x="-14" y="52" width="28" height="7" rx="1.5" />
          <rect x="-14" y="43" width="6" height="10" />
          <rect x="-3" y="43" width="6" height="10" />
          <rect x="8" y="43" width="6" height="10" />
        </g>

        {/* King (center, tallest) */}
        <g transform="translate(120 0)">
          <rect x="-21" y="97" width="42" height="11" rx="4" />
          <rect x="-16" y="88" width="32" height="9" rx="3" />
          <path d="M-13 88 L-8 46 L8 46 L13 88 Z" />
          <rect x="-11" y="41" width="22" height="7" rx="3" />
          <circle cx="0" cy="30" r="10" />
          <rect x="-2.5" y="6" width="5" height="17" rx="2" />
          <rect x="-7" y="11" width="14" height="5" rx="2" />
        </g>

        {/* Pawn (right) */}
        <g transform="translate(178 0)">
          <rect x="-13" y="97" width="26" height="9" rx="3" />
          <path d="M-9 97 L-6 70 L6 70 L9 97 Z" />
          <rect x="-10" y="64" width="20" height="7" rx="2.5" />
          <circle cx="0" cy="55" r="9" />
        </g>
      </g>
    </svg>
  )
}
