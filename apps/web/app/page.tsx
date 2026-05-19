"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"

/* ─── Design tokens ──────────────────────────────────────────────── */
const G = "#20744B"
const G2 = "#2D9D5E"
const DARK_BG = "#080D16"
const DARK_SURFACE = "#111820"
const DARK_BORDER = "rgba(255,255,255,0.07)"
const DARK_TEXT = "#e8edf2"
const DARK_MUTED = "#5a6880"
const LIGHT_BG = "#f7f6f3"
const LIGHT_SURFACE = "#f0ede8"
const LIGHT_BORDER = "#e4e0d8"
const LIGHT_TEXT = "#1a2030"
const LIGHT_MUTED = "#6b7280"

/* ─── Scroll reveal hook ─────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.style.opacity = "1"
          el.style.transform = "translateY(0)"
          obs.disconnect()
        }
      },
      { threshold: 0.08 }
    )
    el.style.opacity = "0"
    el.style.transform = "translateY(24px)"
    el.style.transition = "opacity 0.55s ease, transform 0.55s ease"
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}

/* ─── SVG Icons ──────────────────────────────────────────────────── */
function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

function AakedMark({ size = 28, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: G,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="18" stroke={color} strokeWidth="2.5" fill="none" />
        <circle cx="24" cy="24" r="15" stroke={color} strokeWidth="0.8" fill="none" opacity="0.4" />
        <rect x="18" y="16" width="12" height="16" rx="1.5" fill={color} opacity="0.15" />
        <path d="M21 22h6M21 25h6M21 28h4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path
          d="M20 19l2.5 2 4-4"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

function SectionIcon({
  d,
  size = 24,
  color = G2,
  strokeW = 2,
}: {
  d: string
  size?: number
  color?: string
  strokeW?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeW}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  )
}

/* ─── Nav ────────────────────────────────────────────────────────── */
function LPNav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40)
    window.addEventListener("scroll", h, { passive: true })
    return () => window.removeEventListener("scroll", h)
  }, [])

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: "0 32px",
        height: 64,
        display: "flex",
        alignItems: "center",
        background: scrolled ? "rgba(8,13,22,0.88)" : "transparent",
        backdropFilter: scrolled ? "blur(16px) saturate(1.4)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(16px) saturate(1.4)" : "none",
        borderBottom: scrolled ? `1px solid ${DARK_BORDER}` : "1px solid transparent",
        transition: "all 0.3s ease",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <AakedMark size={30} />
        <span
          style={{
            fontFamily: "var(--font-sora)",
            fontWeight: 800,
            fontSize: 17,
            letterSpacing: "-0.02em",
            color: "#fff",
          }}
        >
          Aaked
        </span>
      </div>

      {/* Nav links */}
      <div style={{ display: "flex", alignItems: "center", gap: 28, marginLeft: 52 }}>
        {[
          { label: "Features", href: "#features" },
          { label: "Open Source", href: "#open-source" },
          { label: "Integrations", href: "#integrations" },
          { label: "FAQ", href: "#faq" },
        ].map((item) => (
          <NavLink key={item.label} href={item.href}>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* CTA buttons */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <OutlineBtn href="https://github.com/aaked-app/aaked" small>
          <GitHubIcon size={14} /> GitHub
        </OutlineBtn>
        <PrimaryBtn href="/register" small>
          Get Early Access <ArrowRight size={13} />
        </PrimaryBtn>
      </div>
    </nav>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [h, setH] = useState(false)
  return (
    <a
      href={href}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        fontFamily: "var(--font-sora)",
        fontSize: 13,
        fontWeight: 500,
        color: h ? "#fff" : DARK_MUTED,
        textDecoration: "none",
        transition: "color 0.15s",
      }}
    >
      {children}
    </a>
  )
}

/* ─── Buttons ────────────────────────────────────────────────────── */
function PrimaryBtn({
  href,
  children,
  small,
  large,
}: {
  href: string
  children: React.ReactNode
  small?: boolean
  large?: boolean
}) {
  const [h, setH] = useState(false)
  const pad = large ? "14px 28px" : small ? "8px 16px" : "11px 22px"
  const fs = large ? 15 : small ? 13 : 14
  return (
    <Link
      href={href}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        fontFamily: "var(--font-sora)",
        fontWeight: 600,
        fontSize: fs,
        padding: pad,
        borderRadius: 8,
        background: h ? "#1d6e44" : G,
        color: "#fff",
        boxShadow: h ? "0 0 24px rgba(45,157,94,0.28)" : "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        textDecoration: "none",
        transition: "all 0.18s ease",
        border: "none",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  )
}

function OutlineBtn({
  href,
  children,
  small,
  large,
  dark,
}: {
  href: string
  children: React.ReactNode
  small?: boolean
  large?: boolean
  dark?: boolean
}) {
  const [h, setH] = useState(false)
  const pad = large ? "14px 28px" : small ? "8px 16px" : "11px 22px"
  const fs = large ? 15 : small ? 13 : 14
  return (
    <Link
      href={href}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        fontFamily: "var(--font-sora)",
        fontWeight: 600,
        fontSize: fs,
        padding: pad,
        borderRadius: 8,
        background: h ? "rgba(255,255,255,0.07)" : "transparent",
        color: dark ? LIGHT_TEXT : DARK_TEXT,
        border: `1px solid ${dark ? LIGHT_BORDER : DARK_BORDER}`,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        textDecoration: "none",
        transition: "all 0.18s ease",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  )
}

/* ─── Hero ───────────────────────────────────────────────────────── */
function HeroSection() {
  const ref = useReveal()
  const ref2 = useReveal()

  return (
    <section
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "120px 32px 80px",
        overflow: "hidden",
        background: DARK_BG,
      }}
    >
      {/* Dot grid pattern */}
      <DotGrid />
      {/* Green radial glow */}
      <div
        style={{
          position: "absolute",
          top: "35%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 800,
          height: 500,
          background: "radial-gradient(ellipse, rgba(45,157,94,0.09) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div
        ref={ref}
        style={{ textAlign: "center", maxWidth: 780, position: "relative", zIndex: 1 }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 16px",
            borderRadius: 999,
            background: "rgba(45,157,94,0.1)",
            border: "1px solid rgba(45,157,94,0.22)",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-sora)",
            color: G2,
            marginBottom: 28,
            letterSpacing: "0.02em",
          }}
        >
          <span
            style={{ width: 6, height: 6, borderRadius: 3, background: G2, display: "inline-block" }}
          />
          Open Source · Free · Self-Hostable
        </div>

        {/* Headline */}
        <h1
          style={{
            fontFamily: "var(--font-sora)",
            fontWeight: 800,
            fontSize: "clamp(48px, 7vw, 72px)",
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            color: "#fff",
            marginBottom: 20,
            textWrap: "pretty" as never,
          }}
        >
          The contract
          <br />
          platform.
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 17,
            lineHeight: 1.7,
            color: DARK_MUTED,
            maxWidth: 560,
            margin: "0 auto 36px",
            fontFamily: "var(--font-manrope)",
          }}
        >
          Draft, negotiate, sign, and manage contracts with AI that runs on your terms. Self-host for
          complete data sovereignty, or let us handle it.
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <PrimaryBtn href="/register" large>
            Get Early Access <ArrowRight size={15} />
          </PrimaryBtn>
          <OutlineBtn href="https://github.com/aaked-app/aaked" large>
            <GitHubIcon size={17} /> View on GitHub
          </OutlineBtn>
        </div>
      </div>

      {/* Product mockup */}
      <div
        ref={ref2}
        style={{
          marginTop: 64,
          width: "100%",
          maxWidth: 1060,
          position: "relative",
          zIndex: 1,
        }}
      >
        <ProductMockup />
      </div>
    </section>
  )
}

function DotGrid() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)`,
        backgroundSize: "28px 28px",
        pointerEvents: "none",
        maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)",
      }}
    />
  )
}

function ProductMockup() {
  const BG = "#0e1520"
  const CARD = "#151e2a"
  const BORDER = "#1e2a38"
  const TXT = "#c8cdd4"
  const MUTED = "#5a6575"

  return (
    <div
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${BORDER}`,
        boxShadow: "0 40px 100px rgba(0,0,0,0.5), 0 0 60px rgba(45,157,94,0.06)",
        background: BG,
      }}
    >
      {/* Browser chrome */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: `1px solid ${BORDER}`,
          background: "#0a1018",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#ff5f57" }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#febc2e" }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#28c840" }} />
        </div>
        <div
          style={{
            flex: 1,
            marginLeft: 12,
            padding: "5px 14px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${BORDER}`,
            fontSize: 11.5,
            fontFamily: "var(--font-jetbrains-mono), monospace",
            color: MUTED,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={MUTED}
            strokeWidth="2.5"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          app.aaked.com
        </div>
      </div>

      {/* App layout */}
      <div style={{ display: "flex", height: 420 }}>
        {/* Sidebar */}
        <div
          style={{
            width: 200,
            borderRight: `1px solid ${BORDER}`,
            padding: "14px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            background: "#0c1420",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 8px 14px",
            }}
          >
            <AakedMark size={22} />
            <span
              style={{
                fontFamily: "var(--font-sora)",
                fontWeight: 800,
                fontSize: 13,
                color: "#fff",
              }}
            >
              Aaked
            </span>
          </div>
          {[
            { label: "Dashboard", active: true },
            { label: "Contracts" },
            { label: "Templates" },
            { label: "Obligations", badge: "3" },
            { label: "Analytics" },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: "6px 10px",
                borderRadius: 5,
                fontSize: 12,
                fontWeight: item.active ? 600 : 400,
                color: item.active ? G2 : MUTED,
                background: item.active ? "rgba(45,157,94,0.1)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontFamily: "var(--font-sora)",
              }}
            >
              {item.label}
              {item.badge && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "1px 5px",
                    borderRadius: 99,
                    background: G2,
                    color: "#fff",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </div>
          ))}
          <div
            style={{
              marginTop: 14,
              paddingTop: 10,
              borderTop: `1px solid ${BORDER}`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: MUTED,
                padding: "0 10px 6px",
                fontFamily: "var(--font-sora)",
              }}
            >
              AI
            </div>
            {["AI Agents", "Create with AI"].map((l) => (
              <div
                key={l}
                style={{
                  padding: "6px 10px",
                  borderRadius: 5,
                  fontSize: 12,
                  color: MUTED,
                  fontFamily: "var(--font-sora)",
                }}
              >
                {l}
              </div>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: "20px 24px", overflow: "hidden" }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              fontFamily: "var(--font-sora)",
              color: "#fff",
              marginBottom: 18,
            }}
          >
            Dashboard
          </div>

          {/* Stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
              marginBottom: 22,
            }}
          >
            {[
              { label: "Total Contracts", value: "284", change: "+12%" },
              { label: "Active", value: "127", change: "+8%" },
              { label: "Pending Review", value: "23", change: "-3" },
              { label: "Total Value", value: "$4.2M", change: "+18%" },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 10, color: MUTED, fontWeight: 500, marginBottom: 4 }}>
                  {stat.label}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    fontFamily: "var(--font-sora)",
                    color: "#fff",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {stat.value}
                </div>
                <div style={{ fontSize: 10, color: G2, fontWeight: 600, marginTop: 2 }}>
                  {stat.change}
                </div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: `1px solid ${BORDER}`,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-sora)",
                color: "#fff",
              }}
            >
              Recent Contracts
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {["Contract", "Counterparty", "Status", "Value", "Expires"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 14px",
                        textAlign: "left",
                        color: MUTED,
                        fontWeight: 500,
                        fontSize: 10,
                        fontFamily: "var(--font-sora)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    name: "SaaS License Agreement",
                    party: "Acme Corp",
                    status: "Active",
                    color: G2,
                    value: "$840K",
                    exp: "Dec 2026",
                  },
                  {
                    name: "NDA — TechStart Inc",
                    party: "TechStart",
                    status: "Pending",
                    color: "#d4850a",
                    value: "—",
                    exp: "Jan 2027",
                  },
                  {
                    name: "Employment Contract",
                    party: "Internal",
                    status: "Draft",
                    color: MUTED,
                    value: "—",
                    exp: "—",
                  },
                  {
                    name: "Data Processing Agreement",
                    party: "CloudBase",
                    status: "Active",
                    color: G2,
                    value: "$120K",
                    exp: "Mar 2027",
                  },
                  {
                    name: "Vendor Services MSA",
                    party: "SupplyPro",
                    status: "Review",
                    color: "#6366f1",
                    value: "$2.1M",
                    exp: "Sep 2026",
                  },
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td style={{ padding: "9px 14px", color: TXT, fontWeight: 500 }}>
                      {row.name}
                    </td>
                    <td style={{ padding: "9px 14px", color: MUTED }}>{row.party}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 99,
                          background: `${row.color}18`,
                          color: row.color,
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "9px 14px",
                        color: TXT,
                        fontFamily: "var(--font-jetbrains-mono), monospace",
                        fontSize: 11,
                      }}
                    >
                      {row.value}
                    </td>
                    <td style={{ padding: "9px 14px", color: MUTED }}>{row.exp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Features Grid ──────────────────────────────────────────────── */
const FEATURES = [
  {
    icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    title: "AI-Powered Drafting",
    desc: "Generate contracts in seconds. Use local models, bring your own API keys, or use our hosted AI — your data, your choice.",
  },
  {
    icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
    title: "Template Library",
    desc: "Pre-built templates for NDAs, SaaS agreements, employment contracts, and more. Customize with smart variables.",
  },
  {
    icon: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M9 12l2 2 4-4",
    title: "Built-In E-Signatures",
    desc: "Send for signing, track status, collect executed copies. A complete signing workflow without third-party costs.",
  },
  {
    icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
    title: "Obligation Tracking",
    desc: "Never miss a renewal, milestone, or compliance date. Automated alerts keep your team ahead of every deadline.",
  },
  {
    icon: "M18 20V10 M12 20V4 M6 20v-6",
    title: "Analytics & Insights",
    desc: "Real-time dashboards for contract value, cycle time, risk exposure, and team productivity.",
  },
  {
    icon: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M2 12h20 M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z",
    title: "Multi-Language & RTL",
    desc: "Full Arabic, French, German, and Spanish support with native RTL layout. Draft contracts in any language.",
  },
]

function FeaturesSection() {
  const ref = useReveal()
  return (
    <section id="features" style={{ background: LIGHT_BG, padding: "100px 32px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div ref={ref} style={{ textAlign: "center", marginBottom: 60 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-sora)",
              color: G,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 12,
            }}
          >
            Features
          </div>
          <h2
            style={{
              fontFamily: "var(--font-sora)",
              fontWeight: 800,
              fontSize: "clamp(28px, 4vw, 40px)",
              letterSpacing: "-0.03em",
              color: LIGHT_TEXT,
              lineHeight: 1.15,
            }}
          >
            Everything you need to manage contracts
          </h2>
          <p
            style={{
              fontSize: 16,
              color: LIGHT_MUTED,
              maxWidth: 520,
              margin: "14px auto 0",
              lineHeight: 1.6,
              fontFamily: "var(--font-manrope)",
            }}
          >
            From first draft to final signature — and every obligation that follows.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {FEATURES.map((f, i) => (
            <FeatureCard key={i} {...f} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  const ref = useReveal()
  const [h, setH] = useState(false)
  return (
    <div
      ref={ref}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        padding: 28,
        borderRadius: 12,
        background: h ? "#fff" : LIGHT_SURFACE,
        border: `1px solid ${h ? LIGHT_BORDER : "transparent"}`,
        boxShadow: h ? "0 8px 32px rgba(0,0,0,0.06)" : "none",
        transition: "all 0.25s ease",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "rgba(32,116,75,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <SectionIcon d={icon} size={20} color={G} strokeW={1.8} />
      </div>
      <h3
        style={{
          fontFamily: "var(--font-sora)",
          fontWeight: 700,
          fontSize: 16,
          color: LIGHT_TEXT,
          marginBottom: 8,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 13.5,
          color: LIGHT_MUTED,
          lineHeight: 1.6,
          fontFamily: "var(--font-manrope)",
        }}
      >
        {desc}
      </p>
    </div>
  )
}

/* ─── Deep Dives ─────────────────────────────────────────────────── */
const DEEP_DIVES = [
  {
    eyebrow: "AI Agents",
    title: "AI that understands your contracts",
    desc: "Specialized AI agents for drafting, review, risk analysis, and extraction — powered by models you control. Connect local LLMs or bring your own API keys. No data leaves your infrastructure unless you choose.",
    mockup: "ai" as const,
    flip: false,
  },
  {
    eyebrow: "Contract Editor",
    title: "From draft to signed in minutes",
    desc: "A rich contract editor with real-time collaboration, clause suggestions, smart variables, and approval workflows. Send for e-signature when ready — no switching tools.",
    mockup: "editor" as const,
    flip: true,
  },
  {
    eyebrow: "Analytics",
    title: "Complete visibility across your portfolio",
    desc: "Track every contract's lifecycle stage, value, risk score, and upcoming obligations. Exportable reports and customizable dashboards give your team the insights they need.",
    mockup: "analytics" as const,
    flip: false,
  },
]

function DeepDivesSection() {
  return (
    <section style={{ background: LIGHT_BG }}>
      {DEEP_DIVES.map((dd, i) => (
        <DeepDiveRow key={i} {...dd} index={i} />
      ))}
    </section>
  )
}

function DeepDiveRow({
  eyebrow,
  title,
  desc,
  mockup,
  flip,
  index,
}: {
  eyebrow: string
  title: string
  desc: string
  mockup: "ai" | "editor" | "analytics"
  flip: boolean
  index: number
}) {
  const ref = useReveal()
  const bg = index % 2 === 0 ? "#f2efe9" : LIGHT_BG

  return (
    <div ref={ref} style={{ padding: "80px 32px", background: bg }}>
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 64,
          flexDirection: flip ? "row-reverse" : "row",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "0 0 45%", minWidth: 280 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-sora)",
              color: G,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            {eyebrow}
          </div>
          <h3
            style={{
              fontFamily: "var(--font-sora)",
              fontWeight: 800,
              fontSize: "clamp(22px, 3vw, 30px)",
              letterSpacing: "-0.025em",
              color: LIGHT_TEXT,
              lineHeight: 1.2,
              marginBottom: 14,
            }}
          >
            {title}
          </h3>
          <p
            style={{
              fontSize: 15,
              color: LIGHT_MUTED,
              lineHeight: 1.7,
              fontFamily: "var(--font-manrope)",
            }}
          >
            {desc}
          </p>
        </div>
        <div style={{ flex: "1 1 300px", minWidth: 280 }}>
          <DeepDiveMockup type={mockup} />
        </div>
      </div>
    </div>
  )
}

function DeepDiveMockup({ type }: { type: "ai" | "editor" | "analytics" }) {
  const BG = "#0e1520"
  const CARD = "#151e2a"
  const BORDER = "#1e2a38"
  const TXT = "#c8cdd4"
  const MUTED = "#5a6575"

  const frame = (children: React.ReactNode) => (
    <div
      style={{
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${BORDER}`,
        background: BG,
        boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 5,
          padding: "9px 14px",
          borderBottom: `1px solid ${BORDER}`,
          background: "#0a1018",
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 4, background: "#ff5f57" }} />
        <div style={{ width: 8, height: 8, borderRadius: 4, background: "#febc2e" }} />
        <div style={{ width: 8, height: 8, borderRadius: 4, background: "#28c840" }} />
      </div>
      {children}
    </div>
  )

  if (type === "ai")
    return frame(
      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 260,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "var(--font-sora)",
            color: "#fff",
          }}
        >
          AI Contract Assistant
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "start" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "rgba(99,102,241,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              flexShrink: 0,
              color: "#818cf8",
              fontFamily: "var(--font-sora)",
              fontWeight: 700,
            }}
          >
            AI
          </div>
          <div
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: "4px 10px 10px 10px",
              padding: "10px 14px",
              fontSize: 12,
              color: TXT,
              lineHeight: 1.6,
              flex: 1,
            }}
          >
            I&apos;ve analyzed the SaaS License Agreement. Here are the key findings:
            <br />
            <br />
            <span style={{ color: "#f59e0b" }}>⚠ Clause 4.2</span> — Auto-renewal with 90-day
            notice period. Consider reducing to 30 days.
            <br />
            <span style={{ color: G2 }}>✓ Clause 7.1</span> — Liability cap is properly set at 12
            months of fees.
            <br />
            <span style={{ color: "#ef4444" }}>✕ Missing</span> — No data processing addendum
            found. Required for GDPR compliance.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "start", justifyContent: "flex-end" }}>
          <div
            style={{
              background: `${G2}18`,
              border: `1px solid ${G2}33`,
              borderRadius: "10px 4px 10px 10px",
              padding: "10px 14px",
              fontSize: 12,
              color: TXT,
              maxWidth: "70%",
            }}
          >
            Add a GDPR-compliant DPA clause and flag the auto-renewal for renegotiation.
          </div>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "rgba(45,157,94,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              flexShrink: 0,
              color: G2,
              fontWeight: 700,
              fontFamily: "var(--font-sora)",
            }}
          >
            You
          </div>
        </div>
      </div>
    )

  if (type === "editor")
    return frame(
      <div style={{ display: "flex", minHeight: 260 }}>
        <div style={{ width: 180, borderRight: `1px solid ${BORDER}`, padding: "16px 12px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: MUTED,
              marginBottom: 10,
              fontFamily: "var(--font-sora)",
            }}
          >
            Document Outline
          </div>
          {[
            "1. Definitions",
            "2. License Grant",
            "3. Payment Terms",
            "4. Confidentiality",
            "5. Termination",
          ].map((c, i) => (
            <div
              key={i}
              style={{
                padding: "5px 8px",
                borderRadius: 4,
                fontSize: 11,
                color: i === 1 ? G2 : MUTED,
                fontWeight: i === 1 ? 600 : 400,
                background: i === 1 ? `${G2}15` : "transparent",
                marginBottom: 2,
                fontFamily: "var(--font-sora)",
              }}
            >
              {c}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "20px 24px" }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              fontFamily: "var(--font-sora)",
              color: "#fff",
              marginBottom: 14,
            }}
          >
            SaaS License Agreement
          </div>
          <div style={{ fontSize: 12, color: TXT, lineHeight: 1.8 }}>
            <span style={{ fontWeight: 600, color: "#fff" }}>2. License Grant</span>
            <br />
            Subject to the terms of this Agreement, Licensor hereby grants to Customer a
            non-exclusive, non-transferable license to access and use the{" "}
            <span style={{ background: `${G2}25`, padding: "1px 4px", borderRadius: 3 }}>
              Software
            </span>{" "}
            during the Subscription Term...
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
            <span
              style={{
                fontSize: 10,
                padding: "3px 8px",
                borderRadius: 4,
                background: `${G2}18`,
                color: G2,
                fontWeight: 600,
              }}
            >
              AI Suggested
            </span>
            <span
              style={{
                fontSize: 10,
                padding: "3px 8px",
                borderRadius: 4,
                background: "rgba(99,102,241,0.12)",
                color: "#818cf8",
                fontWeight: 600,
              }}
            >
              2 Comments
            </span>
          </div>
        </div>
      </div>
    )

  return frame(
    <div style={{ padding: 20, minHeight: 260 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "var(--font-sora)",
          color: "#fff",
          marginBottom: 16,
        }}
      >
        Contract Analytics
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          { label: "Avg. Cycle Time", value: "4.2 days", change: "-18%" },
          { label: "Renewal Rate", value: "94%", change: "+3%" },
          { label: "At Risk", value: "7", change: "-2" },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: MUTED,
                fontWeight: 500,
                fontFamily: "var(--font-sora)",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "var(--font-sora)",
                color: "#fff",
                marginTop: 2,
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 9, color: G2, fontWeight: 600 }}>{s.change}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            marginBottom: 12,
            fontFamily: "var(--font-sora)",
          }}
        >
          Contracts by Month
        </div>
        <div style={{ display: "flex", alignItems: "end", gap: 8, height: 80 }}>
          {[45, 62, 38, 71, 55, 83, 67, 92, 78, 86, 95, 72].map((v, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${v}%`,
                borderRadius: "3px 3px 0 0",
                background: i === 11 ? G2 : `${G2}40`,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m) => (
            <span key={m} style={{ fontSize: 8, color: MUTED, flex: 1, textAlign: "center" }}>
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Open Source ────────────────────────────────────────────────── */
function OpenSourceSection() {
  const ref = useReveal()
  return (
    <section
      id="open-source"
      style={{
        background: DARK_BG,
        padding: "100px 32px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <DotGrid />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 700,
          height: 400,
          background: "radial-gradient(ellipse, rgba(45,157,94,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ maxWidth: 1120, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <div ref={ref} style={{ textAlign: "center", marginBottom: 56 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-sora)",
              color: G2,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 12,
            }}
          >
            Open Source
          </div>
          <h2
            style={{
              fontFamily: "var(--font-sora)",
              fontWeight: 800,
              fontSize: "clamp(28px, 4vw, 40px)",
              letterSpacing: "-0.03em",
              color: "#fff",
              lineHeight: 1.15,
            }}
          >
            Your contracts. Your infrastructure.
          </h2>
          <p
            style={{
              fontSize: 16,
              color: DARK_MUTED,
              maxWidth: 540,
              margin: "14px auto 0",
              lineHeight: 1.6,
              fontFamily: "var(--font-manrope)",
            }}
          >
            Aaked is fully open source under the AGPL License. Deploy on your own servers for
            complete data sovereignty — no vendor lock-in, no per-seat pricing, no compromises.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {[
            {
              icon: "M22 12H2 M5 12V7a5 5 0 0110 0v5 M19 12v5a2 2 0 01-2 2H7a2 2 0 01-2-2v-5",
              title: "Self-Host Anywhere",
              desc: "Docker, Kubernetes, or bare metal. Run Aaked wherever your compliance team needs it. One command to deploy.",
            },
            {
              icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
              title: "Bring Your Own AI",
              desc: "Connect local LLMs, use OpenAI, Anthropic, or any provider. Your API keys, your models — no data leaves your network.",
            },
            {
              icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
              title: "Community Driven",
              desc: "Built by developers and legal teams worldwide. Every feature request, bug fix, and improvement is transparent.",
            },
          ].map((card, i) => (
            <OSCard key={i} {...card} />
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: 48 }}>
          <OutlineBtn href="https://github.com/aaked-app/aaked" large>
            <GitHubIcon size={17} /> Star on GitHub
          </OutlineBtn>
        </div>
      </div>
    </section>
  )
}

function OSCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  const ref = useReveal()
  const [h, setH] = useState(false)
  return (
    <div
      ref={ref}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        padding: 28,
        borderRadius: 12,
        background: h ? DARK_SURFACE : "rgba(17,25,33,0.5)",
        border: `1px solid ${h ? DARK_BORDER : "rgba(28,38,53,0.5)"}`,
        transition: "all 0.25s ease",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "rgba(45,157,94,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <SectionIcon d={icon} size={20} color={G2} strokeW={1.8} />
      </div>
      <h3
        style={{
          fontFamily: "var(--font-sora)",
          fontWeight: 700,
          fontSize: 16,
          color: "#fff",
          marginBottom: 8,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 13.5,
          color: DARK_MUTED,
          lineHeight: 1.6,
          fontFamily: "var(--font-manrope)",
        }}
      >
        {desc}
      </p>
    </div>
  )
}

/* ─── Security ───────────────────────────────────────────────────── */
function SecuritySection() {
  const ref = useReveal()
  const CHECK = "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M9 12l2 2 4-4"
  return (
    <section style={{ background: "#f2efe9", padding: "72px 32px" }}>
      <div ref={ref} style={{ maxWidth: 1120, margin: "0 auto", textAlign: "center" }}>
        <h3
          style={{
            fontFamily: "var(--font-sora)",
            fontWeight: 700,
            fontSize: 20,
            color: LIGHT_TEXT,
            marginBottom: 28,
            letterSpacing: "-0.015em",
          }}
        >
          Enterprise-grade security
        </h3>
        <div
          style={{ display: "flex", justifyContent: "center", gap: 40, flexWrap: "wrap" }}
        >
          {["SOC 2 Type II", "GDPR Compliant", "AES-256 Encryption", "Audit Logging", "SSO / SAML"].map(
            (label) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SectionIcon d={CHECK} size={18} color={G} strokeW={2} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: LIGHT_TEXT,
                    fontFamily: "var(--font-sora)",
                  }}
                >
                  {label}
                </span>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  )
}

/* ─── Integrations ───────────────────────────────────────────────── */
const INTEGRATIONS = [
  "DocuSeal",
  "DocuSign",
  "Slack",
  "Google Drive",
  "Dropbox",
  "Salesforce",
  "HubSpot",
  "Zapier",
  "Microsoft 365",
  "Notion",
  "Jira",
  "Webhooks",
]

function IntegrationsSection() {
  const ref = useReveal()
  const ref2 = useReveal()
  return (
    <section id="integrations" style={{ background: LIGHT_BG, padding: "80px 32px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div ref={ref} style={{ textAlign: "center", marginBottom: 48 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-sora)",
              color: G,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 12,
            }}
          >
            Integrations
          </div>
          <h2
            style={{
              fontFamily: "var(--font-sora)",
              fontWeight: 800,
              fontSize: "clamp(24px, 3.5vw, 32px)",
              letterSpacing: "-0.025em",
              color: LIGHT_TEXT,
              lineHeight: 1.2,
            }}
          >
            Connects to the tools you already use
          </h2>
        </div>

        <div
          ref={ref2}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
            gap: 12,
            maxWidth: 800,
            margin: "0 auto",
          }}
        >
          {INTEGRATIONS.map((name, i) => (
            <IntegrationChip key={name} name={name} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

function IntegrationChip({ name, index }: { name: string; index: number }) {
  const [h, setH] = useState(false)
  const hue = (index * 47) % 360
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        padding: "18px 12px",
        borderRadius: 10,
        border: `1px solid ${h ? G : LIGHT_BORDER}`,
        background: "#fff",
        textAlign: "center",
        fontSize: 11.5,
        fontWeight: 600,
        color: LIGHT_TEXT,
        fontFamily: "var(--font-sora)",
        transition: "all 0.2s",
        boxShadow: h ? "0 4px 16px rgba(0,0,0,0.06)" : "none",
        cursor: "default",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          margin: "0 auto 8px",
          background: `hsl(${hue} 30% 92%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 700,
          color: `hsl(${hue} 40% 40%)`,
        }}
      >
        {name[0]}
      </div>
      {name}
    </div>
  )
}

/* ─── FAQ ────────────────────────────────────────────────────────── */
const FAQ_ITEMS = [
  {
    q: "Is Aaked really free?",
    a: "Yes. Aaked is open source under the AGPL License. You can self-host it at no cost with unlimited users, contracts, and features. We also offer a free hosted version for teams who don't want to manage infrastructure.",
  },
  {
    q: "How does self-hosting work?",
    a: "Deploy with a single Docker command or use our Kubernetes Helm chart. We provide detailed documentation, migration scripts, and community support. Your data never touches our servers.",
  },
  {
    q: "Can I use my own AI models?",
    a: "Absolutely. Aaked supports local LLMs (via Ollama, vLLM, etc.), OpenAI, Anthropic, Azure, and any OpenAI-compatible API. Bring your own API keys — we never proxy your AI requests.",
  },
  {
    q: "Is Aaked suitable for enterprise use?",
    a: "Yes. Aaked includes SSO/SAML, role-based access control, audit logging, SOC 2 readiness, and GDPR compliance tools. Many teams in regulated industries use Aaked in production.",
  },
  {
    q: "How do I migrate from DocuSign or other tools?",
    a: "We provide import tools for DocuSign, PandaDoc, and CSV-based migration. Our team can assist with complex migrations during the early access period.",
  },
  {
    q: "What languages does Aaked support?",
    a: "The interface supports English, Arabic (with full RTL), French, German, and Spanish. You can draft contracts in any language, and the AI features work across all supported languages.",
  },
]

function FAQSection() {
  const ref = useReveal()
  return (
    <section id="faq" style={{ background: "#f2efe9", padding: "80px 32px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div ref={ref} style={{ textAlign: "center", marginBottom: 48 }}>
          <h2
            style={{
              fontFamily: "var(--font-sora)",
              fontWeight: 800,
              fontSize: "clamp(24px, 3.5vw, 32px)",
              letterSpacing: "-0.025em",
              color: LIGHT_TEXT,
            }}
          >
            Frequently asked questions
          </h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {FAQ_ITEMS.map((item, i) => (
            <FAQItem key={i} {...item} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  const ref = useReveal()
  return (
    <div
      ref={ref}
      style={{
        borderRadius: 10,
        overflow: "hidden",
        background: "#fff",
        border: `1px solid ${LIGHT_BORDER}`,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "18px 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-sora)",
          fontSize: 14.5,
          fontWeight: 600,
          color: LIGHT_TEXT,
          textAlign: "left",
          gap: 16,
        }}
      >
        {q}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={LIGHT_MUTED}
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            transition: "transform 0.25s",
            transform: open ? "rotate(180deg)" : "none",
            flexShrink: 0,
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div
        style={{
          maxHeight: open ? 200 : 0,
          overflow: "hidden",
          transition: "max-height 0.35s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <p
          style={{
            padding: "0 22px 18px",
            fontSize: 13.5,
            color: LIGHT_MUTED,
            lineHeight: 1.7,
            fontFamily: "var(--font-manrope)",
          }}
        >
          {a}
        </p>
      </div>
    </div>
  )
}

/* ─── Final CTA ──────────────────────────────────────────────────── */
function FinalCTA() {
  const ref = useReveal()
  return (
    <section
      style={{
        background: DARK_BG,
        padding: "100px 32px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <DotGrid />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 600,
          height: 400,
          background: "radial-gradient(ellipse, rgba(45,157,94,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        ref={ref}
        style={{
          maxWidth: 640,
          margin: "0 auto",
          textAlign: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-sora)",
            fontWeight: 800,
            fontSize: "clamp(28px, 4vw, 40px)",
            letterSpacing: "-0.03em",
            color: "#fff",
            lineHeight: 1.15,
            marginBottom: 16,
          }}
        >
          Ready to take control of your contracts?
        </h2>
        <p
          style={{
            fontSize: 16,
            color: DARK_MUTED,
            lineHeight: 1.6,
            marginBottom: 36,
            fontFamily: "var(--font-manrope)",
          }}
        >
          Get early access to the hosted version, or clone the repo and deploy on your own
          infrastructure today.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <PrimaryBtn href="/register" large>
            Get Early Access <ArrowRight size={15} />
          </PrimaryBtn>
          <OutlineBtn href="https://github.com/aaked-app/aaked" large>
            <GitHubIcon size={17} /> View on GitHub
          </OutlineBtn>
        </div>
      </div>
    </section>
  )
}

/* ─── Footer ─────────────────────────────────────────────────────── */
function LPFooter() {
  return (
    <footer
      style={{
        background: DARK_BG,
        borderTop: `1px solid ${DARK_BORDER}`,
        padding: "48px 32px 32px",
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 48,
          flexWrap: "wrap",
        }}
      >
        <div style={{ maxWidth: 280 }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}
          >
            <AakedMark size={26} />
            <span
              style={{
                fontFamily: "var(--font-sora)",
                fontWeight: 800,
                fontSize: 15,
                color: "#fff",
              }}
            >
              Aaked
            </span>
          </div>
          <p
            style={{
              fontSize: 13,
              color: DARK_MUTED,
              lineHeight: 1.6,
              fontFamily: "var(--font-manrope)",
            }}
          >
            The contract platform. Open source, AI-powered, and built for teams that care about
            data sovereignty.
          </p>
        </div>
        {[
          { title: "Product", links: [{ label: "Features", href: "#features" }, { label: "Integrations", href: "#integrations" }, { label: "Changelog", href: "#" }] },
          { title: "Resources", links: [{ label: "Documentation", href: "#" }, { label: "API Reference", href: "#" }, { label: "Community", href: "#" }] },
          { title: "Company", links: [{ label: "About", href: "#" }, { label: "Contact", href: "#" }, { label: "Privacy", href: "#" }, { label: "Terms", href: "#" }] },
        ].map((col) => (
          <div key={col.title}>
            <h4
              style={{
                fontFamily: "var(--font-sora)",
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
                marginBottom: 14,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {col.title}
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {col.links.map((l) => (
                <FooterLink key={l.label} href={l.href}>
                  {l.label}
                </FooterLink>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          maxWidth: 1120,
          margin: "32px auto 0",
          paddingTop: 32,
          borderTop: `1px solid ${DARK_BORDER}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <span style={{ fontSize: 12, color: DARK_MUTED, fontFamily: "var(--font-manrope)" }}>
          © 2026 Aaked. Open source under AGPL-3.0 License.
        </span>
        <Link
          href="https://github.com/aaked-app/aaked"
          style={{ color: DARK_MUTED, display: "flex" }}
        >
          <GitHubIcon size={16} />
        </Link>
      </div>
    </footer>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [h, setH] = useState(false)
  return (
    <Link
      href={href}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        fontSize: 13,
        color: h ? "#fff" : DARK_MUTED,
        textDecoration: "none",
        transition: "color 0.15s",
        fontFamily: "var(--font-manrope)",
      }}
    >
      {children}
    </Link>
  )
}

/* ─── Page ───────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        fontFamily: "var(--font-manrope), system-ui, sans-serif",
        // Reset any app theme that might leak in
        colorScheme: "light",
      }}
    >
      <LPNav />
      <HeroSection />
      <FeaturesSection />
      <DeepDivesSection />
      <OpenSourceSection />
      <SecuritySection />
      <IntegrationsSection />
      <FAQSection />
      <FinalCTA />
      <LPFooter />
    </div>
  )
}
