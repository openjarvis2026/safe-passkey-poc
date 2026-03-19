import { useState, useEffect, useCallback, useRef } from 'react';
import { type Token } from './tokens';
import { getSwapQuote, type SwapQuote } from './swap';

/** Milliseconds to wait after the user stops typing before fetching. */
const DEBOUNCE_MS = 500;

/** Polling interval: refresh the quote automatically while UI is open. */
const POLL_INTERVAL_MS = 10_000;

/** A quote older than this is considered stale and triggers a re-fetch. */
const QUOTE_EXPIRY_MS = 30_000;

export interface UseSwapQuoteResult {
  quote: SwapQuote | null;
  isLoading: boolean;
  error: string | null;
  isStale: boolean;
  /** Immediately fetch a fresh quote and return it (useful before swap execution). */
  refetch: () => Promise<SwapQuote | null>;
}

/**
 * Hook that manages swap quote lifecycle:
 * - Debounces amount input (500 ms) before fetching
 * - Polls every 10 seconds while the UI is open
 * - Marks quotes stale after 30 seconds and auto-refetches
 */
export function useSwapQuote(
  tokenFrom: Token,
  tokenTo: Token,
  amountIn: string,
): UseSwapQuoteResult {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  /** Monotonically-increasing id; ignore responses from superseded requests. */
  const requestIdRef = useRef(0);
  /** Unix timestamp (ms) of the last successfully fetched quote. */
  const quoteTimestampRef = useRef<number | null>(null);

  const isValidInput =
    Boolean(amountIn) &&
    parseFloat(amountIn) > 0 &&
    tokenFrom.address !== tokenTo.address;

  /** Core fetch — returns the quote so callers can await it directly. */
  const fetchQuote = useCallback(async (): Promise<SwapQuote | null> => {
    if (!amountIn || parseFloat(amountIn) <= 0 || tokenFrom.address === tokenTo.address) {
      setQuote(null);
      setError(null);
      setIsStale(false);
      quoteTimestampRef.current = null;
      return null;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const newQuote = await getSwapQuote(tokenFrom, tokenTo, amountIn);

      if (requestId === requestIdRef.current) {
        setQuote(newQuote);
        setIsStale(false);
        quoteTimestampRef.current = Date.now();
        setIsLoading(false);
      }

      return newQuote;
    } catch (err: any) {
      if (requestId === requestIdRef.current) {
        setQuote(null);
        setIsStale(false);
        setError(err?.message || 'Unable to fetch quote. Try a different amount or token pair.');
        setIsLoading(false);
      }

      return null;
    }
  }, [tokenFrom, tokenTo, amountIn]);

  // ── 1. Debounced fetch when inputs change ────────────────────────────────
  useEffect(() => {
    if (!isValidInput) {
      // Invalidate any in-flight request and clear state
      requestIdRef.current++;
      setQuote(null);
      setError(null);
      setIsStale(false);
      quoteTimestampRef.current = null;
      return;
    }

    const timer = setTimeout(() => {
      fetchQuote();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn, tokenFrom.address, tokenTo.address]);

  // ── 2. Polling: refresh every 10 s while input is valid ─────────────────
  useEffect(() => {
    if (!isValidInput) return;

    const interval = setInterval(() => {
      fetchQuote();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchQuote, isValidInput]);

  // ── 3. Expiry: if quote ages past 30 s, mark stale and re-fetch ──────────
  useEffect(() => {
    if (!isValidInput || !quote) return;

    const expiryTimer = setTimeout(() => {
      const age = quoteTimestampRef.current
        ? Date.now() - quoteTimestampRef.current
        : Infinity;

      if (age >= QUOTE_EXPIRY_MS) {
        setIsStale(true);
        fetchQuote();
      }
    }, QUOTE_EXPIRY_MS);

    return () => clearTimeout(expiryTimer);
  }, [quote, isValidInput, fetchQuote]);

  return { quote, isLoading, error, isStale, refetch: fetchQuote };
}
