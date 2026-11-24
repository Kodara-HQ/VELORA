'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STAFF_ROLES } from '@velora/shared';
import { Suspense, useState } from 'react';
import { FilterSelect, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Dialog } from '@/components/dialog';
import { Alert, Badge, Button, Checkbox, Field } from '@/components/ui';
import { api, ApiError, apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { useCan, useSession } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface StaffRow { id: number; email: string; firstName: string; lastName: string; status: string; lastLoginAt: string | null; roles: Array<{ code: string; name: string }> }
interface Role { id: number; code: string; name: string; description: string; userCount: number; permissions: string[] }

function Inner() {
  const f = useUrlFilters();
  const qc = useQueryClient();
  const me = useSession((s) => s.user);
  const canManage = useCan('users.manage');
  const canRoles = useCan('roles.manage');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const query = { kind: 'staff', q: f.get('q'), role: f.get('role'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-staff', query], queryFn: () => apiWithMeta<StaffRow[]>(`/users${qs(query)}`), placeholderData: (p) => p });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: () => api<Role[]>('/roles'), enabled: useCan('roles.view') });
  const status = useMutation({
    mutationFn: (u: StaffRow) => api(`/users/${u.id}/status`, { method: 'PATCH', body: { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-staff'] }),
  });
  const staffRoles = (roles.data ?? []).filter((r) => (STAFF_ROLES as string[]).includes(r.code));

  return (
    <>
      <PageHeader title="Staff & roles" description="Every user sees only the modules their roles allow. The API enforces this on each request."
        actions={canManage && <Button onClick={() => setCreating(true)}>Add staff member</Button>} />
      {status.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(status.error)}</Alert></div>}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search staff" />
        <FilterSelect label="Role" value={f.get('role')} onChange={(v) => f.set('role', v)} options={[['', 'All roles'], ...staffRoles.map((r) => [r.code, r.name] as [string, string])]} />
      </div>
      <Panel padded={false} className="mb-6">
        <QueryState q={q} empty={!q.data?.data.length}>
          <Table head={['Name', 'Roles', 'Status', 'Last sign-in', '']}>
            {q.data?.data.map((u) => (
              <tr key={u.id}>
                <Td><span className="font-semibold">{u.firstName} {u.lastName}</span>{u.id === me?.id && <Badge tone="outline" className="ml-2">You</Badge>}<span className="block text-xs text-muted">{u.email}</span></Td>
                <Td><span className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.code} tone={r.code === 'super_admin' ? 'ink' : 'neutral'}>{r.name}</Badge>)}</span></Td>
                <Td><StatusPill status={u.status} /></Td>
                <Td className="text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</Td>
                <Td className="whitespace-nowrap text-xs font-semibold">
                  {canRoles && <button type="button" className="underline" onClick={() => setEditing(u)}>Roles</button>}
                  {canManage && u.id !== me?.id && <button type="button" className="ml-3 underline" onClick={() => window.confirm(`${u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} ${u.firstName}?`) && status.mutate(u)}>{u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</button>}
                </Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
      {roles.data && (
        <Panel title="Roles and what they can do">
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {staffRoles.map((r) => (
              <li key={r.code} className="rounded-sm border border-line p-4 text-sm">
                <p className="font-semibold">{r.name} <span className="font-normal text-muted">· {r.userCount}</span></p>
                <p className="mt-1 text-xs text-muted">{r.description}</p>
                <p className="mt-2 text-xs">{r.permissions.length} permissions: {r.permissions.slice(0, 6).join(', ')}{r.permissions.length > 6 && '…'}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {creating && <CreateStaff roles={staffRoles} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ['admin-staff'] }); }} />}
      {editing && <EditRoles user={editing} roles={staffRoles} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['admin-staff'] }); }} />}
    </>
  );
}

function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void }) {
  const isSuper = useSession((s) => s.user?.roles.includes('super_admin'));
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.1em]">Roles</legend>
      {roles.map((r) => (
        <Checkbox key={r.code} disabled={r.code === 'super_admin' && !isSuper} checked={value.includes(r.code)}
          onChange={(e) => onChange(e.target.checked ? [...value, r.code] : value.filter((x) => x !== r.code))}
          label={<span><b>{r.name}</b> <span className="text-muted">· {r.description}</span></span>} />
      ))}
    </fieldset>
  );
}

function CreateStaff({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', roles: [] as string[] });
  const save = useMutation({ mutationFn: () => api('/users/staff', { method: 'POST', body: { ...v, phone: v.phone || undefined } }), onSuccess: onDone });
  const errs = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return (
    <Dialog open onClose={onClose} label="Add staff member" className="max-w-xl">
      <form className="grid gap-4 p-6 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="text-xl font-extrabold sm:col-span-2">Add staff member</h2>
        {save.isError && !Object.keys(errs).length && <div className="sm:col-span-2"><Alert tone="danger">{errorMessage(save.error)}</Alert></div>}
        <Field label="First name" value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} error={errs.firstName} />
        <Field label="Last name" value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} error={errs.lastName} />
        <Field label="Work email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errs.email} />
        <Field label="Mobile (optional)" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="+233…" error={errs.phone} />
        <Field label="Temporary password" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })}
          hint="Share it securely; they should change it at first sign-in." error={errs.password} className="sm:col-span-2" />
        <div className="sm:col-span-2"><RolePicker roles={roles} value={v.roles} onChange={(r) => setV({ ...v, roles: r })} />{errs.roles && <p className="text-[13px] text-danger">{errs.roles}</p>}</div>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={save.isPending} disabled={!v.roles.length}>Create account</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

function EditRoles({ user, roles, onClose, onDone }: { user: StaffRow; roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(user.roles.map((r) => r.code));
  const save = useMutation({ mutationFn: () => api(`/users/${user.id}/roles`, { method: 'PUT', body: { roles: value } }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} label="Edit roles" className="max-w-xl">
      <div className="space-y-4 p-6">
        <h2 className="text-xl font-extrabold">Roles for {user.firstName} {user.lastName}</h2>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <RolePicker roles={roles} value={value} onChange={setValue} />
        <p className="text-xs text-muted">Changes apply immediately, even to sessions already signed in.</p>
        <div className="flex gap-2"><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!value.length}>Save roles</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </div>
    </Dialog>
  );
}

export default function UsersPage() {
  return <Suspense><Inner /></Suspense>;
}
