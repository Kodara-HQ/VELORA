'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader, Panel, QueryState, Table, Td } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Badge, Button, Checkbox, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Supplier { id: number; name: string; contactName: string | null; email: string | null; phone: string | null; address: string | null; country: string | null; paymentTerms: string | null; isActive: boolean; _count: { purchaseOrders: number } }

export default function SuppliersPage() {
  const can = useCan('suppliers.manage');
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const q = useQuery({ queryKey: ['admin-suppliers'], queryFn: () => api<Supplier[]>('/admin/suppliers') });
  return (
    <>
      <PageHeader title="Suppliers" actions={can && <Button onClick={() => setEdit({ isActive: true })}>Add supplier</Button>} />
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.length} emptyText="No suppliers yet.">
          <Table head={['Supplier', 'Contact', 'Country', 'Terms', 'POs', '']}>
            {q.data?.map((s) => (
              <tr key={s.id}>
                <Td className="font-semibold">{s.name} {!s.isActive && <Badge tone="outline">Inactive</Badge>}</Td>
                <Td>{s.contactName}<span className="block text-xs text-muted">{[s.email, s.phone].filter(Boolean).join(' · ')}</span></Td>
                <Td>{s.country}</Td><Td>{s.paymentTerms}</Td><Td>{s._count.purchaseOrders}</Td>
                <Td>{can && <button type="button" className="text-xs font-semibold underline" onClick={() => setEdit(s)}>Edit</button>}</Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Panel>
      {edit && <SupplierDialog value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void qc.invalidateQueries({ queryKey: ['admin-suppliers'] }); }} />}
    </>
  );
}

function SupplierDialog({ value, onClose, onSaved }: { value: Partial<Supplier>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: value.name ?? '', contactName: value.contactName ?? '', email: value.email ?? '', phone: value.phone ?? '', address: value.address ?? '', country: value.country ?? 'Ghana', paymentTerms: value.paymentTerms ?? '', isActive: value.isActive ?? true });
  const save = useMutation({
    mutationFn: () => (value.id ? api(`/admin/suppliers/${value.id}`, { method: 'PATCH', body: v }) : api('/admin/suppliers', { method: 'POST', body: v })),
    onSuccess: onSaved,
  });
  const errs = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const f = (k: keyof typeof v, label: string) => <Field label={label} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} error={errs[k]} />;
  return (
    <Dialog open onClose={onClose} label="Supplier" className="max-w-lg">
      <form className="grid gap-4 p-6 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="text-xl font-extrabold sm:col-span-2">{value.id ? 'Edit supplier' : 'New supplier'}</h2>
        {save.isError && !Object.keys(errs).length && <div className="sm:col-span-2"><Alert tone="danger">{errorMessage(save.error)}</Alert></div>}
        {f('name', 'Company name')}{f('contactName', 'Contact person')}{f('email', 'Email')}{f('phone', 'Phone')}{f('country', 'Country')}{f('paymentTerms', 'Payment terms')}
        <div className="sm:col-span-2">{f('address', 'Address')}</div>
        <div className="sm:col-span-2"><Checkbox label="Active (available for new purchase orders)" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} /></div>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={save.isPending}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}
