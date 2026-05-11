import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    // Layout
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5",
    // Shape
    "rounded-lg border border-transparent",
    // Typography
    "text-sm font-medium whitespace-nowrap",
    // Interaction
    "cursor-pointer select-none outline-none",
    "transition-all duration-150",
    "active:scale-[0.97]",
    // Focus ring — brand green, not indigo
    "focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1",
    // Disabled
    "disabled:pointer-events-none disabled:opacity-50",
    // Icons
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        // ── Primary CTA — forest green brand color ─────────────────
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80",

        // ── Outline — bordered, subtle brand on hover ──────────────
        outline:
          "border-border bg-background text-foreground shadow-sm hover:bg-muted hover:border-primary/25",

        // ── Secondary — soft green tint ────────────────────────────
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",

        // ── Ghost — no chrome, muted hover ─────────────────────────
        ghost:
          "text-foreground hover:bg-muted",

        // ── Destructive — soft red, border included ────────────────
        destructive:
          "border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:border-destructive/30",

        // ── Link — uses brand color, not indigo ───────────────────
        link:
          "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        // Heights: xs=24 · sm=32 · default=36 · lg=40
        default: "h-9 px-4",
        xs:      "h-6 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm:      "h-8 px-3 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg:      "h-10 px-5 text-[0.9375rem]",

        // Square icon variants matching the same heights
        icon:      "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
