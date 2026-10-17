// Hand-drawn SVG illustrations in the ShopOS palette. Decorative only (aria-hidden); size them with className.

type Props = { className?: string }

const C = {
  ink: '#1c1917',
  stone: '#e7e5e4',
  paper: '#fafaf9',
  green: '#059669',
  greenMid: '#10b981',
  greenSoft: '#d1fae5',
  amber: '#f59e0b',
  amberSoft: '#fde68a',
  rose: '#fb7185',
  sky: '#7dd3fc',
  violet: '#a78bfa',
}

function Sparkle({ x, y, size = 6, color = C.amber }: { x: number; y: number; size?: number; color?: string }) {
  return <path d={`M${x} ${y - size}L${x + size * 0.3} ${y - size * 0.3}L${x + size} ${y}L${x + size * 0.3} ${y + size * 0.3}L${x} ${y + size}L${x - size * 0.3} ${y + size * 0.3}L${x - size} ${y}L${x - size * 0.3} ${y - size * 0.3}Z`} fill={color} />
}

export function StorefrontIllustration({ className }: Props) {
  const awning = [0, 1, 2, 3, 4, 5, 6, 7]
  return (
    <svg viewBox="0 0 360 280" className={className} aria-hidden="true" fill="none">
      <circle cx="292" cy="58" r="30" fill={C.amberSoft} />
      <circle cx="292" cy="58" r="18" fill={C.amber} opacity="0.9" />
      <path d="M40 70c0-12 10-20 22-20 6-12 26-14 34-2 12-2 22 6 22 16H40z" fill="#fff" opacity="0.85" />
      <ellipse cx="180" cy="258" rx="150" ry="12" fill={C.ink} opacity="0.08" />
      <rect x="70" y="96" width="220" height="160" rx="6" fill="#fff" stroke={C.ink} strokeWidth="3" />
      <rect x="86" y="70" width="188" height="30" rx="8" fill={C.green} stroke={C.ink} strokeWidth="3" />
      <rect x="150" y="80" width="60" height="10" rx="5" fill="#fff" opacity="0.9" />
      {awning.map((index) => (
        <path key={index} d={`M${62 + index * 29.5} 100h29.5v14a14.75 14.75 0 0 1-29.5 0z`} fill={index % 2 ? '#fff' : C.greenMid} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      ))}
      <rect x="88" y="136" width="104" height="82" rx="4" fill={C.greenSoft} stroke={C.ink} strokeWidth="3" />
      <path d="M88 166h104M88 194h104" stroke={C.ink} strokeWidth="2.5" />
      <rect x="98" y="146" width="14" height="20" rx="2" fill={C.rose} />
      <rect x="116" y="150" width="12" height="16" rx="2" fill={C.amber} />
      <rect x="132" y="144" width="16" height="22" rx="2" fill={C.sky} />
      <circle cx="162" cy="158" r="8" fill={C.violet} />
      <rect x="176" y="148" width="10" height="18" rx="2" fill={C.green} />
      <rect x="98" y="174" width="20" height="20" rx="3" fill={C.amberSoft} />
      <rect x="124" y="178" width="14" height="16" rx="2" fill={C.rose} opacity="0.8" />
      <rect x="144" y="172" width="18" height="22" rx="2" fill={C.green} opacity="0.7" />
      <rect x="168" y="176" width="16" height="18" rx="2" fill={C.sky} />
      <rect x="208" y="136" width="62" height="120" rx="4" fill={C.amberSoft} stroke={C.ink} strokeWidth="3" />
      <rect x="218" y="148" width="42" height="40" rx="3" fill="#fff" stroke={C.ink} strokeWidth="2.5" />
      <text x="239" y="173" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.green} fontFamily="system-ui, sans-serif">OPEN</text>
      <circle cx="258" cy="210" r="4" fill={C.ink} />
      <path d="M34 256c0-16 6-30 16-30s16 14 16 30" fill={C.greenMid} stroke={C.ink} strokeWidth="3" />
      <rect x="38" y="236" width="24" height="20" rx="3" fill={C.amber} stroke={C.ink} strokeWidth="3" />
      <path d="M298 256c-2-22 6-38 16-40 8 6 10 22 4 40" fill={C.green} stroke={C.ink} strokeWidth="3" />
      <rect x="300" y="238" width="22" height="18" rx="3" fill={C.rose} stroke={C.ink} strokeWidth="3" />
      <circle cx="40" cy="150" r="11" fill={C.amber} stroke={C.ink} strokeWidth="2.5" />
      <path d="M35 150l3.5 3.5 6.5-7" fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="322" cy="140" r="9" fill={C.amber} stroke={C.ink} strokeWidth="2.5" />
      <Sparkle x={330} y={110} size={7} />
      <Sparkle x={30} y={116} size={5} color={C.greenMid} />
    </svg>
  )
}

export function EmptyBoxIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden="true" fill="none">
      <ellipse cx="100" cy="146" rx="70" ry="8" fill={C.ink} opacity="0.07" />
      <path d="M40 70l60-22 60 22v62l-60 18-60-18z" fill={C.amberSoft} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 70l60 20 60-20M100 90v60" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 70l-16 22 60 20 16-22z" fill="#fde9a8" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M160 70l16 22-60 20-16-22z" fill="#fbd776" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M58 116l20 6" stroke={C.ink} strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      <Sparkle x={100} y={24} size={8} />
      <Sparkle x={150} y={36} size={5} color={C.greenMid} />
      <Sparkle x={52} y={40} size={5} color={C.sky} />
    </svg>
  )
}

export function EmptyCartIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true" fill="none">
      <ellipse cx="104" cy="138" rx="66" ry="7" fill={C.ink} opacity="0.07" />
      <path d="M26 34h20l18 66h84l16-48H56" stroke={C.ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M58 52h106l-16 48H64z" fill={C.greenSoft} />
      <path d="M78 52l6 48M104 52v48M130 52l-6 48M62 76h92" stroke={C.green} strokeWidth="2.5" opacity="0.6" />
      <circle cx="74" cy="122" r="9" fill="#fff" stroke={C.ink} strokeWidth="4" />
      <circle cx="140" cy="122" r="9" fill="#fff" stroke={C.ink} strokeWidth="4" />
      <path d="M64 100l-6 12h90" stroke={C.ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="150" y="12" width="22" height="26" rx="4" fill={C.rose} stroke={C.ink} strokeWidth="2.5" transform="rotate(12 161 25)" />
      <circle cx="122" cy="22" r="10" fill={C.amber} stroke={C.ink} strokeWidth="2.5" />
      <Sparkle x={96} y={18} size={6} color={C.greenMid} />
    </svg>
  )
}

export function PeopleIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true" fill="none">
      <ellipse cx="100" cy="140" rx="74" ry="7" fill={C.ink} opacity="0.07" />
      <circle cx="72" cy="56" r="20" fill="#f5c9a0" stroke={C.ink} strokeWidth="3" />
      <path d="M52 50c2-16 16-22 28-18 6 2 10 8 10 14-10-2-24-2-38 4z" fill={C.ink} />
      <path d="M36 138c0-26 16-42 36-42s36 16 36 42z" fill={C.green} stroke={C.ink} strokeWidth="3" />
      <circle cx="134" cy="64" r="17" fill="#d9a77c" stroke={C.ink} strokeWidth="3" />
      <path d="M116 60c0-14 10-20 20-20s18 8 16 20c-6-6-18-8-36 0z" fill="#57534e" />
      <path d="M104 138c0-22 13-36 30-36s30 14 30 36z" fill={C.amber} stroke={C.ink} strokeWidth="3" />
      <rect x="138" y="14" width="48" height="34" rx="8" fill="#fff" stroke={C.ink} strokeWidth="3" />
      <path d="M148 48l-6 10 14-10" fill="#fff" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M150 31h24M150 38h16" stroke={C.green} strokeWidth="3" strokeLinecap="round" />
      <Sparkle x={30} y={30} size={6} />
    </svg>
  )
}

export function TruckIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 220 150" className={className} aria-hidden="true" fill="none">
      <ellipse cx="112" cy="138" rx="90" ry="7" fill={C.ink} opacity="0.07" />
      <path d="M8 120h204" stroke={C.ink} strokeWidth="3" strokeLinecap="round" strokeDasharray="2 10" opacity="0.4" />
      <rect x="20" y="46" width="112" height="70" rx="6" fill="#fff" stroke={C.ink} strokeWidth="3" />
      <rect x="34" y="60" width="26" height="24" rx="2" fill={C.amberSoft} stroke={C.ink} strokeWidth="2.5" />
      <rect x="64" y="66" width="22" height="18" rx="2" fill={C.amber} stroke={C.ink} strokeWidth="2.5" />
      <rect x="90" y="58" width="28" height="26" rx="2" fill="#fbd776" stroke={C.ink} strokeWidth="2.5" />
      <path d="M132 64h38l24 26v26h-62z" fill={C.green} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M142 72h24l14 16h-38z" fill={C.sky} stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="54" cy="118" r="13" fill={C.ink} />
      <circle cx="54" cy="118" r="5" fill={C.stone} />
      <circle cx="166" cy="118" r="13" fill={C.ink} />
      <circle cx="166" cy="118" r="5" fill={C.stone} />
      <path d="M196 102h6" stroke={C.amber} strokeWidth="4" strokeLinecap="round" />
      <path d="M2 70h12M0 86h10M4 102h10" stroke={C.green} strokeWidth="3" strokeLinecap="round" opacity="0.5" />
      <Sparkle x={190} y={34} size={6} />
    </svg>
  )
}

export function ChartIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true" fill="none">
      <ellipse cx="100" cy="140" rx="74" ry="7" fill={C.ink} opacity="0.07" />
      <rect x="28" y="20" width="144" height="110" rx="10" fill="#fff" stroke={C.ink} strokeWidth="3" />
      <rect x="46" y="84" width="16" height="30" rx="3" fill={C.greenSoft} stroke={C.ink} strokeWidth="2.5" />
      <rect x="72" y="66" width="16" height="48" rx="3" fill={C.greenMid} stroke={C.ink} strokeWidth="2.5" />
      <rect x="98" y="74" width="16" height="40" rx="3" fill={C.amberSoft} stroke={C.ink} strokeWidth="2.5" />
      <rect x="124" y="46" width="16" height="68" rx="3" fill={C.green} stroke={C.ink} strokeWidth="2.5" />
      <path d="M44 66l28-18 26 10 34-26" stroke={C.amber} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M124 32h10v10" stroke={C.amber} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={168} y={18} size={7} />
    </svg>
  )
}

export function ReceiptIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 180 160" className={className} aria-hidden="true" fill="none">
      <ellipse cx="90" cy="150" rx="56" ry="6" fill={C.ink} opacity="0.07" />
      <path d="M46 14h88v120l-11-8-11 8-11-8-11 8-11-8-11 8-11-8-11 8z" fill="#fff" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M60 36h40M60 54h60M60 68h48M60 82h56" stroke={C.stone} strokeWidth="5" strokeLinecap="round" />
      <path d="M60 104h60" stroke={C.green} strokeWidth="6" strokeLinecap="round" />
      <circle cx="132" cy="40" r="22" fill={C.green} stroke={C.ink} strokeWidth="3" />
      <path d="M121 40l8 8 14-16" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={30} y={40} size={6} />
      <Sparkle x={160} y={88} size={5} color={C.rose} />
    </svg>
  )
}

export function CelebrateIllustration({ className }: Props) {
  const confetti = [[22, 30, C.rose, 20], [160, 24, C.amber, -15], [36, 104, C.sky, 40], [170, 96, C.violet, 10], [60, 16, C.greenMid, -30], [140, 128, C.rose, 25]] as const
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true" fill="none">
      {confetti.map(([x, y, color, rotate], index) => <rect key={index} x={x} y={y} width="10" height="5" rx="2" fill={color} transform={`rotate(${rotate} ${x} ${y})`} />)}
      <circle cx="100" cy="74" r="46" fill={C.greenSoft} />
      <circle cx="100" cy="74" r="34" fill={C.green} stroke={C.ink} strokeWidth="3" />
      <path d="M84 74l11 11 22-24" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={150} y={56} size={8} />
      <Sparkle x={48} y={64} size={6} color={C.greenMid} />
    </svg>
  )
}

export function OfflineIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true" fill="none">
      <ellipse cx="100" cy="140" rx="64" ry="7" fill={C.ink} opacity="0.07" />
      <path d="M52 100a26 26 0 0 1 4-52 34 34 0 0 1 64-6 26 26 0 0 1 28 30 18 18 0 0 1-6 28z" fill="#fff" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M80 70c12-10 28-10 40 0M90 82c6-5 14-5 20 0" stroke={C.stone} strokeWidth="5" strokeLinecap="round" />
      <circle cx="100" cy="92" r="4" fill={C.ink} />
      <path d="M60 40l84 72" stroke={C.rose} strokeWidth="6" strokeLinecap="round" />
      <path d="M92 118v12M108 118v12M86 130h28" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function RocketIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 170" className={className} aria-hidden="true" fill="none">
      <circle cx="100" cy="80" r="64" fill={C.greenSoft} />
      <path d="M100 18c22 18 30 46 24 82H76c-6-36 2-64 24-82z" fill="#fff" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="100" cy="62" r="11" fill={C.sky} stroke={C.ink} strokeWidth="3" />
      <path d="M76 84l-18 22 20-4M124 84l18 22-20-4" fill={C.green} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M86 100h28l-4 10H90z" fill={C.stone} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M92 112c0 16 8 26 8 34 0-8 8-18 8-34z" fill={C.amber} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      <path d="M97 114c0 8 3 14 3 18 0-4 3-10 3-18z" fill={C.rose} />
      <Sparkle x={36} y={40} size={7} />
      <Sparkle x={166} y={52} size={6} color={C.green} />
      <Sparkle x={154} y={130} size={5} color={C.rose} />
    </svg>
  )
}

export function ControlPanelIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 220 150" className={className} aria-hidden="true" fill="none">
      <ellipse cx="110" cy="140" rx="86" ry="7" fill={C.ink} opacity="0.07" />
      <rect x="18" y="16" width="184" height="112" rx="12" fill="#fff" stroke={C.ink} strokeWidth="3" />
      <rect x="18" y="16" width="44" height="112" rx="12" fill={C.green} stroke={C.ink} strokeWidth="3" />
      <rect x="30" y="34" width="20" height="6" rx="3" fill="#fff" opacity="0.9" />
      <rect x="30" y="50" width="20" height="6" rx="3" fill="#fff" opacity="0.5" />
      <rect x="30" y="66" width="20" height="6" rx="3" fill="#fff" opacity="0.5" />
      <rect x="74" y="28" width="56" height="34" rx="6" fill={C.greenSoft} stroke={C.ink} strokeWidth="2.5" />
      <rect x="136" y="28" width="56" height="34" rx="6" fill={C.amberSoft} stroke={C.ink} strokeWidth="2.5" />
      <path d="M84 50h20M146 50h26" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M78 112l22-20 18 10 30-28 40 18" stroke={C.green} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="148" cy="74" r="5" fill={C.amber} stroke={C.ink} strokeWidth="2" />
      <Sparkle x={206} y={14} size={7} />
    </svg>
  )
}

export function SettingsIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true" fill="none">
      <ellipse cx="100" cy="140" rx="64" ry="7" fill={C.ink} opacity="0.07" />
      <g transform="translate(78 70)">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => <rect key={angle} x="-7" y="-46" width="14" height="18" rx="3" fill={C.green} stroke={C.ink} strokeWidth="2.5" transform={`rotate(${angle})`} />)}
        <circle r="34" fill={C.green} stroke={C.ink} strokeWidth="3" />
        <circle r="14" fill="#fff" stroke={C.ink} strokeWidth="3" />
      </g>
      <g transform="translate(146 46)">
        {[0, 60, 120, 180, 240, 300].map((angle) => <rect key={angle} x="-5" y="-26" width="10" height="11" rx="2" fill={C.amber} stroke={C.ink} strokeWidth="2" transform={`rotate(${angle})`} />)}
        <circle r="18" fill={C.amber} stroke={C.ink} strokeWidth="2.5" />
        <circle r="7" fill="#fff" stroke={C.ink} strokeWidth="2.5" />
      </g>
      <Sparkle x={160} y={110} size={6} color={C.sky} />
    </svg>
  )
}

// Empty and first-run states: an illustration, a heading, a line of help and an optional action.
export function EmptyState({ illustration: Art, title, children, action }: { illustration: (props: Props) => React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center animate-in fade-in-0 zoom-in-95 duration-300">
      <Art className="h-32 w-auto" />
      <p className="mt-4 font-semibold text-stone-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
