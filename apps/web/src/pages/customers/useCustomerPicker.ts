import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { withQuery, type Page } from '../../lib/pages';

export type PickableCustomer = { id: string; firstName: string; lastName: string };

/** How many customers the picker lists. Beyond this it offers a search. */
const PICKER_SIZE = 100;
const TYPING_PAUSE_MS = 250;

function useAfterPause(value: string) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return settled;
}

/**
 * The customers New job can choose from. A small workspace lists them all. A
 * larger one lists the first hundred and searches the rest on the server. The
 * chosen customer stays listed whatever the search shows, including one chosen
 * by a link who is not among the first hundred.
 */
export function useCustomerPicker(customerId: string) {
  const [search, setSearch] = useState('');
  const term = useAfterPause(search.trim());
  const [picked, setPicked] = useState<PickableCustomer | null>(null);
  const list = useQuery({
    queryKey: ['customers', 'picker', term],
    queryFn: () => api<Page<PickableCustomer>>(withQuery('/customers', { search: term, limit: PICKER_SIZE })),
    placeholderData: (previous) => previous,
  });
  const items = list.data?.items ?? [];
  const listed = items.find((item) => item.id === customerId);
  const remembered = picked?.id === customerId ? picked : undefined;
  const linked = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api<PickableCustomer>(`/customers/${encodeURIComponent(customerId)}`),
    enabled: Boolean(customerId) && list.isSuccess && !listed && !remembered,
  });
  const selected = listed ?? remembered ?? linked.data;
  const total = list.data?.total ?? 0;

  return {
    search,
    setSearch,
    /** Whether there are more customers than the picker can list at once. */
    searchable: Boolean(search || term) || total > items.length,
    options: selected && !listed ? [selected, ...items] : items,
    shown: items.length,
    total,
    selected,
    /** Keeps the choice on show when a later search no longer lists it. */
    remember: (customer: PickableCustomer) => setPicked(customer),
    isLoading: list.isLoading,
    isError: list.isError,
    refetch: list.refetch,
  };
}
