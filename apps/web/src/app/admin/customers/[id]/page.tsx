'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AddressText } from '@/components/address-form';
import { humanize, KpiTile, PageHeader, Panel, QueryState, StatusPill, Table, Td } from '@/components/admin/ui';
import { Alert, Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import type { Address, OrderSummary } from '@/lib/types';

interface Customer {
  id: number; firstName: string; lastName: string; email: string; phone: string | null; status: string; createdAt: string; lastLoginAt: string | null; emailVerified: boolean; referralCode: string | null;
  stats: { orderCount: number; lifetimeValue: string; averageOrderValue: string; lastOrderAt: string | null; wishlistItems: number };
  segment: string; marketingOptIn: boolean;
  loyalty: { tier: string; pointsBalance: number; lifetimePoints: number; transactions: Array<{ id: number; type: string; points: number; description: string | null; createdAt: string }> } | null;
  addresses: Address[]; orders: OrderSummary[];
  loginActivity: Array<{ success: boolean; reason: string | null; ipAddress: string | null; createdAt: string }>;
}

const SEGMENT: Record<string, string> = { VIP: 'VIP', LOYAL: 'Loyal', NEW: 'New', AT_RISK: 'At risk', PROSPECT: 'Prospect', REGULAR: 'Regular' };

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canManage = useCan('customers.manage');
  const q = useQuery({ queryKey: ['admin-customer', id], queryFn: () => api<Customer>(`/admin/customers/${id}`) });
  const status = useMutation({
    mutationFn: (s: 'ACTIVE' | 'SUSPENDED') => api<Customer>(`/admin/customers/${id}/status`, { method: 'PATCH', body: { status: s } }),
    onSuccess: (c) => qc.setQueryData(['admin-customer', id], c),
  });
  const c = q.data;
  return (
    <>
      <PageHeader title={c ? `${c.firstName} ${c.lastName}` : 'Customer'} back={{ href: '/admin/customers', label: 'Customers' }}
        description={c && <span className="flex flex-wrap items-center gap-2"><StatusPill status={c.status} /><Badge tone="ink">{SEGMENT[c.segment]}</Badge> {c.email}{c.phone && ` · ${c.phone}`} · joined {new Date(c.createdAt).toLocaleDateString('en-GB')}</span>}
        actions={c && canManage && (c.status === 'ACTIVE'
          ? <Button variant="danger" onClick={() => window.confirm('Suspend this customer? They will be signed out everywhere and cannot sign in.') && status.mutate('SUSPENDED')} loading={status.isPending}>Suspend</Button>
          : <Button onClick={() => status.mutate('ACTIVE')} loading={status.isPending}>Reactivate</Button>)} />
      {status.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(status.error)}</Alert></div>}
      <QueryState q={q}>
        {c && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Lifetime value" value={formatMoney(c.stats.lifetimeValue)} hint={`${c.stats.orderCount} orders`} />
              <KpiTile label="Average order" value={formatMoney(c.stats.averageOrderValue)} />
              <KpiTile label="Rewards" value={`${(c.loyalty?.pointsBalance ?? 0).toLocaleString()} pts`} hint={c.loyalty?.tier.toLowerCase()} />
              <KpiTile label="Last order" value={c.stats.lastOrderAt ? new Date(c.stats.lastOrderAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'} hint={`${c.stats.wishlistItems} saved in wishlist`} />
            </div>
            <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
              <Panel title="Orders" padded={false}>
                <QueryState q={{ isPending: false, isError: false, error: null }} empty={!c.orders.length} emptyText="No orders yet.">
                  <Table head={['Order', 'Placed', 'Items', 'Status', 'Total']}>
                    {c.orders.map((o) => (
                      <tr key={o.orderNumber}>
                        <Td><Link href={`/admin/orders/${o.orderNumber}`} className="font-semibold hover:underline">{o.orderNumber}</Link></Td>
                        <Td className="text-muted">{formatDateTime(o.placedAt)}</Td><Td>{o.itemCount}</Td><Td><StatusPill status={o.status} /></Td>
                        <Td className="text-right font-semibold">{formatMoney(o.grandTotal)}</Td>
                      </tr>
                    ))}
                  </Table>
                </QueryState>
              </Panel>
              <div className="space-y-6">
                <Panel title="Addresses">
                  {!c.addresses.length ? <p className="text-sm text-muted">None saved.</p> : <ul className="space-y-4">{c.addresses.map((a) => <li key={a.id}><AddressText a={a} />{a.isDefault && <Badge tone="ink">Default</Badge>}</li>)}</ul>}
                </Panel>
                <Panel title="Account">
                  <dl className="grid grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-muted">Email verified</dt><dd>{c.emailVerified ? 'Yes' : 'No'}</dd>
                    <dt className="text-muted">Marketing emails</dt><dd>{c.marketingOptIn ? 'Opted in' : 'Opted out'}</dd>
                    <dt className="text-muted">Referral code</dt><dd className="font-mono">{c.referralCode}</dd>
                    <dt className="text-muted">Last sign-in</dt><dd>{c.lastLoginAt ? formatDateTime(c.lastLoginAt) : '—'}</dd>
                  </dl>
                </Panel>
                <Panel title="Recent sign-ins">
                  <ul className="space-y-1.5 text-xs">
                    {c.loginActivity.map((l, i) => <li key={i}><Badge tone={l.success ? 'success' : 'danger'}>{l.success ? 'OK' : humanize(l.reason ?? 'failed')}</Badge> {l.ipAddress} · {formatDateTime(l.createdAt)}</li>)}
                    {!c.loginActivity.length && <li className="text-muted">None recorded.</li>}
                  </ul>
                </Panel>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
