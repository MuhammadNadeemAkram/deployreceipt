"use client";
import { useState } from "react";
export function PdfExport({ reportId }: { reportId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${reportId}/pdf`, {
        method: "POST",
        headers: { Accept: "application/pdf" },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "Unable to export PDF.");
      }
      if (!response.headers.get("content-type")?.includes("application/pdf"))
        throw new Error("Please sign in again before exporting.");
      const bytes = await response.blob();
      const url = URL.createObjectURL(bytes);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `DeployReceipt-${reportId}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to export PDF.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        className="button"
        onClick={download}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Generating PDF…" : "Export PDF"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="field-hint">
        Includes all findings, regardless of filters. One export per 30 seconds.
      </p>
    </div>
  );
}
