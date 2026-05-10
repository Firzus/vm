"use client";

import { useEffect, useRef } from "react";

type Options = {
  /** Delay before the first child animates in, in seconds. */
  delay?: number;
  /** Per-item stagger, in seconds. */
  stagger?: number;
  /** Easing string, in GSAP syntax. */
  ease?: string;
  /** y-offset (px) to start from. */
  y?: number;
  /** Whether to run on mount. Default true. */
  enabled?: boolean;
  /** Selector for children to animate. Default "[data-reveal]". */
  selector?: string;
};

/**
 * Run a single GSAP timeline that fades + lifts every element matching
 * `selector` inside the returned ref. Respects prefers-reduced-motion via
 * gsap.matchMedia, and cleans up on unmount.
 *
 * Usage:
 *
 *   const ref = useGsapReveal<HTMLDivElement>({ stagger: 0.05 });
 *   return (
 *     <div ref={ref}>
 *       <h1 data-reveal>Title</h1>
 *       <p data-reveal>Body</p>
 *     </div>
 *   );
 */
export function useGsapReveal<T extends HTMLElement>({
  delay = 0,
  stagger = 0.06,
  ease = "power3.out",
  y = 14,
  enabled = true,
  selector = "[data-reveal]",
}: Options = {}) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const { default: gsap } = await import("gsap");
      if (cancelled || !root) return;

      const targets = root.querySelectorAll(selector);
      if (targets.length === 0) return;

      const mm = gsap.matchMedia();

      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          reduce: "(prefers-reduced-motion: reduce)",
        },
        (ctx) => {
          const reduce = ctx.conditions?.reduce === true;
          gsap.set(targets, { opacity: 0, y: reduce ? 0 : y });
          gsap.to(targets, {
            opacity: 1,
            y: 0,
            duration: reduce ? 0.01 : 0.65,
            ease,
            stagger: reduce ? 0 : stagger,
            delay: reduce ? 0 : delay,
            clearProps: "transform",
          });
        },
        root,
      );

      cleanup = () => mm.revert();
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [delay, stagger, ease, y, enabled, selector]);

  return ref;
}
