import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Editorial-Swiss button. The default tone is solid ink-on-paper; the
 * `link` variant carries the signature vermilion underline that traces
 * left-to-right on hover (powered by the `.ink-underline` class in
 * globals.css). All variants honor focus-visible with a vermilion ring.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "font-medium tracking-tight",
    "transition-[background-color,color,border-color,transform] duration-200 ease-out",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "rounded-[2px]",
  ].join(" "),
  {
    variants: {
      variant: {
        // Solid ink button — primary CTA.
        default:
          "bg-ink text-paper hover:bg-ink-soft active:translate-y-[1px]",
        // Vermilion CTA — used sparingly (onboarding "Commencer", etc.).
        primary:
          "bg-vermilion text-paper hover:bg-[color-mix(in_oklab,var(--vermilion)_88%,black)] active:translate-y-[1px]",
        // Hairline outline, ink-on-paper.
        outline:
          "border border-ink/80 bg-transparent text-ink hover:bg-ink hover:text-paper",
        // Soft outline, paper-on-paper.
        secondary:
          "border border-rule bg-paper-2 text-ink hover:bg-paper-3",
        // Plain text button — used inline in editorial copy.
        ghost:
          "bg-transparent text-ink hover:text-vermilion",
        // Vermilion destructive (rare — restart/delete).
        destructive:
          "bg-vermilion text-paper hover:bg-[color-mix(in_oklab,var(--vermilion)_88%,black)] active:translate-y-[1px]",
        // Underlined link — uses .ink-underline for the vermilion trace.
        link: "ink-underline text-ink bg-transparent px-0",
      },
      size: {
        default: "h-9 px-4 py-2 text-sm has-[>svg]:px-3",
        xs: "h-7 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-[15px] has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
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
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
