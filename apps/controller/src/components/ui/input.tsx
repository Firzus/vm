import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[2px] border border-rule bg-paper px-3 py-1 text-[13px] text-ink shadow-none outline-none transition-[border-color,box-shadow]",
        "selection:bg-vermilion selection:text-paper",
        "placeholder:text-ink-muted/70",
        "focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ring/30",
        "aria-invalid:border-vermilion aria-invalid:ring-vermilion/20",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
