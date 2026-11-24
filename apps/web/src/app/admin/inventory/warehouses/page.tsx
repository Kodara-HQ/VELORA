'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GHANA_REGIONS } from '@velora/shared';
import { useState } from 'react';
import { useWarehouses, type Warehouse } from '@/components/admin/inventory-shared';
import { PageHeader, Panel, QueryState, Select, Table, Td } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Badge, Button, Checkbox, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

export default function WarehousesPage() {
  const can = useCan('warehouses.manage');
  const qc = useQueryClient();
  const q = useWarehouses();
  const [edit, setEdit] = useState<Partial<Warehouse> | null>(null);
  return (
    <>
      <PageHeader title="Warehouses" description="Orders reserve stock from the default warehouse first." actions={can && <Button onClick={() => setEdit({ isActive: true })}>Add warehouse</Button>} />
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.length}>
          <Table head={['Code', 'Name', 'Location', 'Phone', 'Status', '']}>
            {q.data?.map((w) => (
              <tr key={w.id}>
                <Td className="font-mono font-semibold">{w.code}</Td>
                <Td>{w.name} {w.isDefault && <Badge tone="ink">Default</Badge>}</Td>
                <Td>{[w.address, w.city, w.region].filter(Boolean).join(', ')}</Td>
                <Td>{w.phone}</Td>
                <Td>{w.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="outline">Inactive</Badge>}</Td>
                <Td>{can && <button type="button" className="text-xs font-semibold underline" onClick={() => setEdit(w)}>Edit</button>}</Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Panel>
      {edit && <WarehouseDialog value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void qc.invalidateQueries({ queryKey: ['admin-warehouses'] }); }} />}
    </>
  );
}

function WarehouseDialog({ value, onClose, onSaved }: { value: Partial<Warehouse>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ code: value.code ?? '', name: value.name ?? '', address: value.address ?? '', city: value.city ?? '', region: value.region ?? '', phone: value.phone ?? '', isActive: value.isActive ?? true, isDefault: value.isDefault ?? false });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, region: v.region || undefined };
      return value.id ? api(`/admin/warehouses/${value.id}`, { method: 'PATCH', body }) : api('/admin/warehouses', { method: 'POST', body });
    },
    onSuccess: onSaved,
  });
  const errs = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return (
    <Dialog open onClose={onClose} label="Warehouse" className="max-w-lg">
      <form className="grid gap-4 p-6 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="text-xl font-extrabold sm:col-span-2">{value.id ? 'Edit warehouse' : 'New warehouse'}</h2>
        {save.isError && !Object.keys(errs).length && <div className="sm:col-span-2"><Alert tone="danger">{errorMessage(save.error)}</Alert></div>}
        <Field label="Code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="TMA-01" error={errs.code} />
        <Field label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errs.name} />
        <Field label="Address" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} className="sm:col-span-2" />
        <Field label="Town" value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
        <Select label="Region" value={v.region} onChange={(e) => setV({ ...v, region: e.target.value })}><option value="">—</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</Select>
        <Field label="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} error={errs.phone} />
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Active" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
          <Checkbox label="Default fulfilment warehouse" checked={v.isDefault} onChange={(e) => setV({ ...v, isDefault: e.target.checked })} />
        </div>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={save.isPending}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}
