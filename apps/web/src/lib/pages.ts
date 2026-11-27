import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './api';

/** One page of a long list, as the api sends it. */
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  /** Every row that matches the filters, not just the ones on this page. */
  total: number;
};

type Params = Record<string, string | number | null | undefined>;

/** `path` with the parameters that have a value. */
export function withQuery(path: string, params: Params) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(name, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/**
 * A list the server pages and filters, grown by "Load more". While a new filter
 * loads, the rows already on screen stay, marked as placeholder data.
 */
export function usePagedList<P extends Page<unknown>>(key: unknown[], path: string, params: Params = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...key, params],
    queryFn: ({ pageParam }) => api<P>(withQuery(path, { ...params, cursor: pageParam })),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}
