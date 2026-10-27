import { useCallback, useEffect, useState } from 'react';

import type { HealthPayload, HealthState } from '../types';

const POLL_INTERVAL_MS = 10_000;

export function useHealth() {
  const [state, setState] = useState<HealthState>({
    status: 'checking',
    payload: null,
    checkedAt: null,
  });

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/health', {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Health check returned ${response.status}`);
      }

      const payload = (await response.json()) as HealthPayload;

      setState({
        status: payload.status === 'ok' ? 'online' : 'offline',
        payload,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      setState({
        status: 'offline',
        payload: null,
        checkedAt: new Date().toISOString(),
      });
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [check]);

  return { ...state, refresh: check };
}