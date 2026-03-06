// SVG icons to replace emojis throughout the UI

interface IconProps {
  size?: number
  color?: string
  className?: string
}

export function BulletinIcon({ size = 16, color = 'currentColor', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="1" width="12" height="14" rx="1" stroke={color} strokeWidth="1.5" />
      <path d="M5 5h6M5 8h6M5 11h4" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="1" r="1.5" fill={color} />
    </svg>
  )
}

export function MemoryIcon({ size = 16, color = 'currentColor', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2C5 2 3 4.5 3 7c0 2 1 3.5 2.5 4.5L5 14h6l-.5-2.5C12 10.5 13 9 13 7c0-2.5-2-5-5-5z" stroke={color} strokeWidth="1.5" />
      <path d="M6 14h4" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 8h4" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

export function RequestIcon({ size = 16, color = 'currentColor', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 3h12l-1 9H3L2 3z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M1 3h14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 6v3M10 6v3" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

export function ActivityIcon({ size = 16, color = 'currentColor', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke={color} strokeWidth="1.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M3.5 12.5l1.2-1.2M11.3 4.7l1.2-1.2" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

export function SendIcon({ size = 14, color = 'currentColor', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 2l12 6-12 6V9l8-1-8-1V2z" fill={color} />
    </svg>
  )
}

export function ImageIcon({ size = 14, color = 'currentColor', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke={color} strokeWidth="1.2" />
      <circle cx="5" cy="6" r="1.5" stroke={color} strokeWidth="1" />
      <path d="M1.5 11l3.5-3 2.5 2 3-4 4 5" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

// Department icons (replacing emojis)
export function BoltIcon({ size = 16, color = '#ff6b9d', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" fill={color} />
    </svg>
  )
}

export function WrenchIcon({ size = 16, color = '#00d4aa', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M10.5 2.5a4 4 0 00-5.2 5.2L2 11l1.5 1.5 1.5 1.5 3.3-3.3a4 4 0 005.2-5.2l-2 2-1.5-1.5 2-2z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function SearchIcon({ size = 16, color = '#ffaa00', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke={color} strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ChartIcon({ size = 16, color = '#00ff88', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 14V6l3 2 3-5 3 3 3-4v12H2z" fill={color} opacity="0.2" />
      <path d="M2 6l3 2 3-5 3 3 3-4" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M2 14h12" stroke={color} strokeWidth="1" opacity="0.4" />
    </svg>
  )
}

export function PaletteIcon({ size = 16, color = '#bb88ff', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2a6 6 0 00-1 11.9c.7.1 1-.3 1-.7v-2.5c0-.8.7-1.2 1.3-.7a3 3 0 10-1.3-5v0" stroke={color} strokeWidth="1.3" />
      <circle cx="5.5" cy="6" r="1" fill={color} />
      <circle cx="8" cy="4.5" r="1" fill={color} />
      <circle cx="10.5" cy="6" r="1" fill={color} />
    </svg>
  )
}

export function ClipboardIcon({ size = 16, color = '#ff8844', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="2" width="10" height="12" rx="1" stroke={color} strokeWidth="1.3" />
      <path d="M6 2V1h4v1" stroke={color} strokeWidth="1.2" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

export function ChainIcon({ size = 16, color = '#4488ff', className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M6 10l-1.5 1.5a2.1 2.1 0 003 3L9 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 6l1.5-1.5a2.1 2.1 0 00-3-3L7 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 10l4-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// Map department ID to icon component
const DEPT_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  coo: BoltIcon,
  engineering: WrenchIcon,
  operations: SearchIcon,
  research: ChartIcon,
  product: PaletteIcon,
  admin: ClipboardIcon,
  blockchain: ChainIcon,
}

export function DeptIcon({ deptId, size = 16, className }: { deptId: string; size?: number; className?: string }) {
  const Icon = DEPT_ICONS[deptId] || BoltIcon
  return <Icon size={size} className={className} />
}
