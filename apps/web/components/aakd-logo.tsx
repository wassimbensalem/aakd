/**
 * AakdLogo — shared brand mark.
 * Use <AakdLogoMark> for the square icon only (sidebar, favicon context).
 * Use <AakdLogo> for the full lockup (mark + wordmark).
 */

interface LogoMarkProps {
  size?: number
  className?: string
}

export function AakdLogoMark({ size = 26, className }: LogoMarkProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.23),
        background: "#20744B",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#ffffff",
        flexShrink: 0,
      }}
    >
      <svg
        width={Math.round(size * 0.6)}
        height={Math.round(size * 0.6)}
        viewBox="0 0 48 48"
        fill="none"
      >
        <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2.5" fill="none" />
        <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="0.8" fill="none" opacity="0.4" />
        <rect x="18" y="16" width="12" height="16" rx="1.5" fill="currentColor" opacity="0.15" />
        <path d="M21 22h6M21 25h6M21 28h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M20 19l2.5 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

interface LogoProps {
  size?: number
  className?: string
  wordmarkClassName?: string
}

export function AakdLogo({ size = 26, className, wordmarkClassName }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <AakdLogoMark size={size} />
      <span
        className={`font-extrabold tracking-tight ${wordmarkClassName ?? ""}`}
        style={{
          fontFamily: "var(--font-sora), 'Sora', sans-serif",
          letterSpacing: "-0.02em",
          fontSize: Math.round(size * 0.54),
        }}
      >
        Aakd
      </span>
    </div>
  )
}
