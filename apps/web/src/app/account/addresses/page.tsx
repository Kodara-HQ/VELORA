'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AddressFields, AddressText, cleanAddress, emptyAddress, validateAddress, type AddressValues } from '@/components/address-form';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/shop';
import type { Address } from '@/lib/types';

export default function AddressesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['addresses'], queryFn: () => api<Address[]>('/me/addresses') });
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => api<Address[]>(`/me/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: (list) => qc.setQueryData(['addresses'], list),
  });
  const makeDefault = useMutation({
    mutationFn: (a: Address) => api<Address>(`/me/addresses/${a.id}`, { method: 'PUT', body: { ...toValues(a), isDefault: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });

  if (editing) return <AddressEditor initial={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['addresses'] }); }} />;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Saved addresses</h2>
        <Button size="sm" onClick={() => setEditing('new')}>Add address</Button>
      </div>
      {(del.isError || makeDefault.isError) && <div className="mb-4"><Alert tone="danger">{errorMessage(del.error ?? makeDefault.error)}</Alert></div>}
      {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert> : !q.data.length ? (
        <EmptyState title="No saved addresses" body="Save an address to check out faster next time." action={<Button onClick={() => setEditing('new')}>Add an address</Button>} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {q.data.map((a) => (
            <li key={a.id}>
              <Card className="flex h-full flex-col p-5">
                <div className="mb-3 flex items-center gap-2">
                  {a.label && <span className="text-xs font-semibold uppercase tracking-wider">{a.label}</span>}
                  {a.isDefault && <Badge tone="ink">Default</Badge>}
                </div>
                <AddressText a={toValues(a)} />
                <div className="mt-auto flex flex-wrap gap-4 pt-4 text-sm font-semibold">
                  <button type="button" className="underline underline-offset-4" onClick={() => setEditing(a)}>Edit</button>
                  {!a.isDefault && <button type="button" className="underline underline-offset-4" onClick={() => makeDefault.mutate(a)}>Make default</button>}
                  <button type="button" className="text-danger underline underline-offset-4" disabled={del.isPending}
                    onClick={() => window.confirm('Delete this address?') && del.mutate(a.id)}>Delete</button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function toValues(a: Address): AddressValues {
  return { label: a.label ?? '', recipientName: a.recipientName, phone: a.phone, line1: a.line1, line2: a.line2 ?? '', city: a.city, region: a.region, digitalAddress: a.digitalAddress ?? '', landmark: a.landmark ?? '' };
}

function AddressEditor({ initial, onDone }: { initial: Address | null; onDone: () => void }) {
  const [v, setV] = useState<AddressValues>(initial ? toValues(initial) : { ...emptyAddress, label: '' });
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api<Address>(initial ? `/me/addresses/${initial.id}` : '/me/addresses', { method: initial ? 'PUT' : 'POST', body: { ...cleanAddress(v), isDefault } }),
    onSuccess: onDone,
    onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
  });
  const submit = () => {
    const e = validateAddress(v);
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };
  return (
    <Card className="p-6">
      <h2 className="mb-5 text-xl font-extrabold">{initial ? 'Edit address' : 'New address'}</h2>
      {save.isError && !Object.keys(errors).length && <div className="mb-4"><Alert tone="danger">{errorMessage(save.error)}</Alert></div>}
      <div className="mb-5 max-w-xs"><Field label="Label (optional)" value={v.label ?? ''} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Home, Office…" /></div>
      <AddressFields value={v} onChange={setV} errors={errors} />
      <div className="mt-5"><Checkbox label="Use as my default address" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /></div>
      <div className="mt-6 flex gap-3">
        <Button onClick={submit} loading={save.isPending}>Save address</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  );
}
