import { useState, useEffect, useCallback, useRef } from 'react';
import { repoApi } from '@/lib/api';
import type { Diff } from 'shared/types';

interface UseProjectDiffsOptions {
  repoId: string | null;
  enabled?: boolean;
  pollInterval?: number;
  onEditDetected?: () => void;
}

export function useProjectDiffs({
  repoId,
  enabled = true,
  pollInterval = 3000,
  onEditDetected,
}: UseProjectDiffsOptions) {
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDiffs = useCallback(async () => {
    if (!repoId || !enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await repoApi.getDiff(repoId);
      setDiffs(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch diffs';
      setError(message);
      console.error('Failed to fetch diffs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [repoId, enabled]);

  // Start polling
  useEffect(() => {
    if (!enabled || !repoId) return;

    // Initial fetch
    void fetchDiffs();

    // Set up polling
    const poll = () => {
      timeoutRef.current = setTimeout(() => {
        void fetchDiffs();
        poll();
      }, pollInterval);
    };

    poll();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, repoId, pollInterval, fetchDiffs]);

  // Manual refresh function (for edit tool call detection)
  const refresh = useCallback(() => {
    void fetchDiffs();
    onEditDetected?.();
  }, [fetchDiffs, onEditDetected]);

  return {
    diffs,
    isLoading,
    error,
    refresh,
  };
}
