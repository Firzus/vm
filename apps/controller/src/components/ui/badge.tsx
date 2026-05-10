import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden",
    "border border-transparent rounded-[2px] px-2 py-0.5",
    "font-mono text-[10px] uppercase tracking-[0.14em] whitespace-nowrap",
    "transition-[color,background-color,border-color]",
    "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-ink text-paper [a&]:hover:bg-ink-soft",
        secondary:
          "bg-paper-2 text-ink [a&]:hover:bg-paper-3",
        destructive:
          "bg-vermilion text-paper [a&]:hover:bg-[color-mix(in_oklab,var(--vermilion)_88%,black)]",
        outline:
          "border-rule text-ink [a&]:hover:bg-paper-2",
        ghost:
          "text-ink-muted [a&]:hover:text-ink",
        link:
          "text-ink underline-offset-4 [a&]:hover:underline [a&]:hover:decoration-vermilion",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
