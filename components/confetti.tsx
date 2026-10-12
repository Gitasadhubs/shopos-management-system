'use client'

import { useMemo } from 'react'

// A short burst of confetti. Change `burst` (e.g. a counter) to fire it again.
const COLORS = ['#10b981', '#f59e0b', '#fb7185', '#38bdf8', '#a78bfa', '#facc15']

export function Confetti({ burst }: { burst: number }) {
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, index) => {
    // Deterministic spread per burst, so renders do not reshuffle the pieces.
    const seed = Math.sin((burst + 1) * (index + 1) * 12.9898) * 43758.5453
    const random = seed - Math.floor(seed)
    const angle = (index / 36) * Math.PI * 2 + random
    const distance = 120 + random * 220
    return { color: COLORS[index % COLORS.length], dx: `${Math.cos(angle) * distance}px`, dy: `${Math.sin(angle) * distance * 0.8 + 140}px`, rot: `${(random - 0.5) * 900}deg`, delay: `${random * 120}ms` }
  }), [burst])
  if (!burst) return null
  return (
    <div key={burst} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {pieces.map((piece, index) => <span key={index} className="shopos-confetti-piece" style={{ background: piece.color, animationDelay: piece.delay, ['--dx' as string]: piece.dx, ['--dy' as string]: piece.dy, ['--rot' as string]: piece.rot }} />)}
    </div>
  )
}
