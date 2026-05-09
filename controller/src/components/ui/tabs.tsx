"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  [
    "group/tabs-list inline-flex w-fit items-center justify-center text-ink/60",
    "group-data-[orientation=horizontal]/tabs:h-auto",
    "group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  ].join(" "),
  {
    variants: {
      variant: {
        // Pill list — kept for compat. Not used in the editorial layout.
        default: "rounded-[2px] bg-paper-2 p-[3px]",
        // Editorial line — what the console actually uses. The trigger
        // owns its own indicator; the list is a transparent strip.
        line: "gap-4 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Shared
        "relative inline-flex items-center gap-1.5 whitespace-nowrap font-medium tracking-tight",
        "text-ink/55 transition-colors hover:text-ink",
        "px-2 py-1.5 text-[12px]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // Default (pill) variant
        "group-data-[variant=default]/tabs-list:rounded-[2px]",
        "group-data-[variant=default]/tabs-list:data-[state=active]:bg-paper",
        "group-data-[variant=default]/tabs-list:data-[state=active]:text-ink",
        "group-data-[variant=default]/tabs-list:data-[state=active]:shadow-[0_1px_0_0_rgba(10,10,10,0.06)]",
        // Line variant — vermilion underline
        "group-data-[variant=line]/tabs-list:data-[state=active]:text-ink",
        "group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:left-0 group-data-[variant=line]/tabs-list:after:right-0 group-data-[variant=line]/tabs-list:after:-bottom-[7px] group-data-[variant=line]/tabs-list:after:h-[1.5px] group-data-[variant=line]/tabs-list:after:bg-vermilion group-data-[variant=line]/tabs-list:after:scale-x-0 group-data-[variant=line]/tabs-list:after:origin-left group-data-[variant=line]/tabs-list:after:transition-transform group-data-[variant=line]/tabs-list:after:duration-300 group-data-[variant=line]/tabs-list:data-[state=active]:after:scale-x-100",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
