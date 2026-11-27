import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CHARGE_CATEGORIES, COST_CATEGORIES } from '@vip/shared';
import { api } from '../../lib/api';
import { formatCategory, money } from '../../lib/format';
import { useSession } from '../../lib/session';
import { Card, fieldClass, secondaryBtn } from '../../components/ui';
import type { JobDetail } from './types';

/** The Money tab, moved out of the job page as it was. It is redesigned in its own change. */
export function MoneyTab({ job }: { job: JobDetail }) {
  const { canWrite, currency } = useSession();
  const queryClient = useQueryClient();
  const id = job.id;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['job', id] });
  const [cost, setCost] = useState({ category: 'TRANSPORT', description: '', amount: '' });
  const [charge, setCharge] = useState({ category: 'TRANSPORT', description: '', amount: '' });
  const costMutation = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${id}/costs`, {
        method: 'POST',
        body: JSON.stringify({ ...cost, amount: Number(cost.amount) }),
      }),
    onSuccess: () => {
      setCost({ category: 'TRANSPORT', description: '', amount: '' });
      void invalidate();
    },
  });
  const chargeMutation = useMutation({
    mutationFn: () =>
      api(`/import-jobs/${id}/charges`, {
        method: 'POST',
        body: JSON.stringify({ ...charge, amount: Number(charge.amount) }),
      }),
    onSuccess: () => {
      setCharge({ category: 'TRANSPORT', description: '', amount: '' });
      void invalidate();
    },
  });

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="font-semibold">Internal costs</h2>
        <p className="text-xs text-ink/45">Never shown to the customer.</p>
        <ul className="mt-3 space-y-2 text-sm">
          {job.costs.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>
                {item.description}
                <span className="block text-xs text-ink/45">{formatCategory(item.category)}</span>
              </span>
              <span className="font-semibold">{money(item.amount, currency)}</span>
            </li>
          ))}
        </ul>
        {canWrite ? (
          <div className="mt-4 grid gap-2">
            <select
              className={fieldClass}
              value={cost.category}
              onChange={(event) => setCost({ ...cost, category: event.target.value })}
            >
              {COST_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {formatCategory(item)}
                </option>
              ))}
            </select>
            <input
              className={fieldClass}
              placeholder="Description"
              value={cost.description}
              onChange={(event) => setCost({ ...cost, description: event.target.value })}
            />
            <input
              className={fieldClass}
              placeholder="Amount"
              value={cost.amount}
              onChange={(event) => setCost({ ...cost, amount: event.target.value })}
            />
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => costMutation.mutate()}
              disabled={!cost.description || !cost.amount}
            >
              Add cost
            </button>
          </div>
        ) : null}
      </Card>
      <Card>
        <h2 className="font-semibold">Customer charges</h2>
        <p className="text-xs text-ink/45">What the customer is billed.</p>
        <ul className="mt-3 space-y-2 text-sm">
          {job.charges.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>
                {item.description}
                <span className="block text-xs text-ink/45">{formatCategory(item.category)}</span>
              </span>
              <span className="font-semibold">{money(item.amount, currency)}</span>
            </li>
          ))}
        </ul>
        {canWrite ? (
          <div className="mt-4 grid gap-2">
            <select
              className={fieldClass}
              value={charge.category}
              onChange={(event) => setCharge({ ...charge, category: event.target.value })}
            >
              {CHARGE_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {formatCategory(item)}
                </option>
              ))}
            </select>
            <input
              className={fieldClass}
              placeholder="Description"
              value={charge.description}
              onChange={(event) => setCharge({ ...charge, description: event.target.value })}
            />
            <input
              className={fieldClass}
              placeholder="Amount"
              value={charge.amount}
              onChange={(event) => setCharge({ ...charge, amount: event.target.value })}
            />
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => chargeMutation.mutate()}
              disabled={!charge.description || !charge.amount}
            >
              Add charge
            </button>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
