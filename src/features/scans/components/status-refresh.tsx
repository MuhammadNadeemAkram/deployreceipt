"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export function StatusRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!active) return;
    let count = 0;
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (++count > 120) {
        setPaused(true);
        clearInterval(interval);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [active, router]);
  if (!active) return null;
  return (
    <p className="field-hint" role="status">
      {paused
        ? "Automatic updates paused. "
        : "Updates every few seconds while this tab is visible. "}
      <button className="text-button" onClick={() => router.refresh()}>
        Refresh now
      </button>
    </p>
  );
}
