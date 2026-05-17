/**
 * ClauseFlowLogo — shared brand mark.
 * Use <ClauseFlowLogoMark> for the square icon only (sidebar, favicon context).
 * Use <ClauseFlowLogo> for the full lockup (mark + wordmark).
 */

interface LogoMarkProps {
  size?: number
  className?: string
}

export function ClauseFlowLogoMark({ size = 26, className }: LogoMarkProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.23),
        background: "hsl(var(--primary))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "hsl(var(--primary-foreground))",
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

export function ClauseFlowLogo({ size = 26, className, wordmarkClassName }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <ClauseFlowLogoMark size={size} />
      <span
        className={`font-extrabold tracking-tight ${wordmarkClassName ?? ""}`}
        style={{
          fontFamily: "var(--font-sora), 'Sora', sans-serif",
          letterSpacing: "-0.02em",
          fontSize: Math.round(size * 0.54),
        }}
      >
        ClauseFlow
      </span>
    </div>
  )
}
