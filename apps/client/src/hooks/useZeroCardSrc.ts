import { useEffect, useState } from "react";

import { createZeroCardVariantDataUrl } from "../utils/zeroCardFilter";

const zeroCardSrcCache = new Map<string, string>();

export function useZeroCardSrc(
  regularSrc: string | undefined,
  enabled: boolean,
): string | undefined {
  const [generatedSrc, setGeneratedSrc] = useState<string | undefined>(() => {
    if (!enabled || !regularSrc) {
      return regularSrc;
    }

    return zeroCardSrcCache.get(regularSrc) ?? regularSrc;
  });

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !regularSrc) {
      setGeneratedSrc(regularSrc);
      return () => {
        cancelled = true;
      };
    }

    const cached = zeroCardSrcCache.get(regularSrc);

    if (cached) {
      setGeneratedSrc(cached);
      return () => {
        cancelled = true;
      };
    }

    setGeneratedSrc(regularSrc);

    createZeroCardVariantDataUrl(regularSrc)
      .then((nextSrc) => {
        zeroCardSrcCache.set(regularSrc, nextSrc);

        if (!cancelled) {
          setGeneratedSrc(nextSrc);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGeneratedSrc(regularSrc);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [regularSrc, enabled]);

  return generatedSrc;
}
