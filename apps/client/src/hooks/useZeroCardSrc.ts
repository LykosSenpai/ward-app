import { useEffect, useState } from "react";

import { ZERO_CARD_FILTER_VERSION, createZeroCardVariantDataUrl } from "../utils/zeroCardFilter";

const zeroCardSrcCache = new Map<string, string>();

function getCacheKey(src: string): string {
  return `${ZERO_CARD_FILTER_VERSION}:${src}`;
}

export function useZeroCardSrc(
  regularSrc: string | undefined,
  enabled: boolean,
): string | undefined {
  const [generatedSrc, setGeneratedSrc] = useState<string | undefined>(() => {
    if (!enabled || !regularSrc) {
      return regularSrc;
    }

    return zeroCardSrcCache.get(getCacheKey(regularSrc)) ?? regularSrc;
  });

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !regularSrc) {
      setGeneratedSrc(regularSrc);
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = getCacheKey(regularSrc);
    const cached = zeroCardSrcCache.get(cacheKey);

    if (cached) {
      setGeneratedSrc(cached);
      return () => {
        cancelled = true;
      };
    }

    setGeneratedSrc(regularSrc);

    createZeroCardVariantDataUrl(regularSrc)
      .then((nextSrc) => {
        zeroCardSrcCache.set(cacheKey, nextSrc);

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
