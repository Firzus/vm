import type { Metadata, Viewport } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PaperShader } from "@/components/visuals/paper-shader";
import { OnboardingHost } from "@/components/onboarding/onboarding";
import { MobileGate } from "@/components/responsive/mobile-gate";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  // Fraunces is a variable font: omitting weight (or using "variable")
  // unlocks the full axis range, which is required for the `axes` option.
  axes: ["opsz", "SOFT"],
  style: ["normal", "italic"],
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "VM Console — An editorial control surface",
  description:
    "Spin up multiple isolated Ubuntu desktops, side by side, drivable from a browser tab or an AI agent.",
};

export const viewport: Viewport = {
  themeColor: "#f5f1e8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        {/* Background grain shader — single canvas behind every page. */}
        <PaperShader />

        <TooltipProvider delayDuration={150}>
          {/* < 640px: editorial gate; >= 640px: full console. */}
          <MobileGate>
            <div className="h-screen w-screen">{children}</div>
          </MobileGate>

          {/* Globally-mounted onboarding modal (also reachable from header). */}
          <OnboardingHost />
        </TooltipProvider>
      </body>
    </html>
  );
}
