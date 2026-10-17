import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewState } from '../domain/model';
import { request, subscribe } from './client';

export function useArchive(query: string, page: number, pageSize: number) {
  const [data, setData] = useState<ViewState>();
  const [error, setError] = useState<string>();
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const value = await request({ type: 'view', query, page, pageSize });
      if (current === sequence.current) {
        setData(value);
        setError(undefined);
      }
    } catch (cause) {
      if (current === sequence.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load your archive.',
        );
    }
  }, [query, page, pageSize]);
  useEffect(() => {
    void reload();
    const unsubscribe = subscribe(() => {
      void reload();
    });
    return () => {
      sequence.current += 1;
      unsubscribe();
    };
  }, [reload]);
  return { data, error, reload };
}
