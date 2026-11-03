"use client";
import Image from "next/image";
import { useState } from "react";
export function EvidencePreview({ url, kind }: { url: string; kind: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p role="status">
      Screenshot missing, expired, revoked or unavailable. No replacement image
      is provided.
    </p>
  ) : (
    <a href={url} target="_blank" rel="noreferrer">
      <Image
        src={url}
        alt={`${kind} screenshot from the reviewed scan`}
        width={kind === "mobile" ? 390 : 1440}
        height={kind === "mobile" ? 844 : 900}
        unoptimized
        onError={() => setFailed(true)}
        className="review-preview"
      />
    </a>
  );
}
