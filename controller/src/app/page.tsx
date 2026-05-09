import { Suspense } from "react";
import { VmTabs } from "@/components/console/vm-tabs";

export const dynamic = "force-dynamic";

/**
 * Top-level page = a tab shell over N concurrent VM consoles. The VM list
 * is fetched client-side via SWR so the page renders instantly even when
 * Docker is slow to enumerate containers.
 */
export default function Home() {
  return (
    <Suspense fallback={null}>
      <VmTabs />
    </Suspense>
  );
}
