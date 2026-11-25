import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentProvider, Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env';

export interface InitInput {
  reference: string;
  amount: Prisma.Decimal;
  currency: string;
  email: string;
  orderNumber: string;
  callbackUrl: string;
  cancelUrl: string;
}
export interface InitResult { authorizationUrl: string; providerReference?: string }

export type VerifiedStatus = 'success' | 'failed' | 'abandoned' | 'pending';
export interface VerifyResult {
  status: VerifiedStatus;
  /** Major units (GH₵), as a decimal */
  amount: Prisma.Decimal;
  currency: string;
  method?: PaymentMethod;
  providerReference?: string;
  cardLast4?: string;
  cardBrand?: string;
  payerPhone?: string;
  failureReason?: string;
  raw: unknown;
}
export interface RefundResult { status: 'completed' | 'pending'; providerReference?: string }

export interface PaymentGateway {
  readonly code: PaymentProvider;
  readonly label: string;
  readonly detail: string;
  /** Can refunds be pushed through the provider's API? Otherwise Finance pays out manually. */
  readonly apiRefunds: boolean;
  initialize(input: InitInput): Promise<InitResult>;
  verify(reference: string): Promise<VerifyResult>;
  refund?(reference: string, amount: Prisma.Decimal): Promise<RefundResult>;
}

const TIMEOUT_MS = 15_000;
const toMinor = (d: Prisma.Decimal) => d.mul(100).toDecimalPlaces(0).toNumber();
const fromMinor = (n: number) => new Prisma.Decimal(n).div(100);

/** Trims provider payloads before storing them: keeps the audit trail, drops anything card-like. */
export function scrub(raw: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(raw ?? null, (k, v) => (/^(authorization_code|signature|bin|cvv|pan|card_number|token)$/i.test(k) ? '[redacted]' : v))) ?? {};
}

async function call<T>(url: string, init: RequestInit, provider: string, logger: Logger): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    logger.error(`${provider} unreachable: ${(e as Error).message}`);
    throw new BadGatewayException({ message: `${provider} is not responding. Please try again or choose pay on delivery.`, code: 'GATEWAY_UNAVAILABLE' });
  }
  const json = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !json) {
    logger.error(`${provider} ${init.method ?? 'GET'} ${new URL(url).pathname} → ${res.status}`);
    throw new BadGatewayException({ message: `${provider} could not process the request. Please try again.`, code: 'GATEWAY_ERROR' });
  }
  return json;
}

// ─────────────────────────── Paystack ───────────────────────────

interface PaystackTxn {
  id: number; status: string; reference: string; amount: number; currency: string; channel: string; gateway_response?: string;
  authorization?: { last4?: string; brand?: string; bank?: string; mobile_money_number?: string; channel?: string } | null;
  customer?: { phone?: string | null };
}

export function mapPaystackTxn(t: PaystackTxn): VerifyResult {
  const status: VerifiedStatus = t.status === 'success' ? 'success' : t.status === 'abandoned' ? 'abandoned'
    : ['failed', 'reversed'].includes(t.status) ? 'failed' : 'pending';
  const bank = (t.authorization?.bank ?? '').toUpperCase();
  const method: PaymentMethod | undefined = t.channel === 'card' ? PaymentMethod.CARD
    : t.channel === 'mobile_money' ? (bank.includes('MTN') ? PaymentMethod.MOMO_MTN : /VOD|TELECEL/.test(bank) ? PaymentMethod.MOMO_TELECEL : /ATL|AIRTEL|TIGO|\bAT\b/.test(bank) ? PaymentMethod.MOMO_AT : PaymentMethod.MOMO_MTN)
    : t.channel === 'bank' || t.channel === 'bank_transfer' ? PaymentMethod.BANK_TRANSFER : undefined;
  return {
    status, amount: fromMinor(t.amount), currency: t.currency, method, providerReference: String(t.id),
    cardLast4: t.channel === 'card' ? t.authorization?.last4 : undefined, cardBrand: t.channel === 'card' ? t.authorization?.brand : undefined,
    payerPhone: t.authorization?.mobile_money_number ?? t.customer?.phone ?? undefined,
    failureReason: status === 'success' ? undefined : t.gateway_response, raw: t,
  };
}

@Injectable()
export class PaystackGateway implements PaymentGateway {
  readonly code = PaymentProvider.PAYSTACK;
  readonly label = 'Card or Mobile Money';
  readonly detail = 'Visa, Mastercard, MTN MoMo, Telecel Cash or AT Money · secured by Paystack';
  readonly apiRefunds = true;
  private readonly logger = new Logger('Paystack');
  private readonly base = 'https://api.paystack.co';

  constructor(private readonly config: ConfigService<Env, true>) {}

  get secret() {
    return this.config.get('PAYSTACK_SECRET_KEY', { infer: true }) ?? '';
  }
  get enabled() {
    return !!this.secret;
  }
  private headers() {
    return { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' };
  }

  async initialize(i: InitInput): Promise<InitResult> {
    const r = await call<{ status: boolean; message: string; data: { authorization_url: string; reference: string; access_code: string } }>(
      `${this.base}/transaction/initialize`,
      { method: 'POST', headers: this.headers(), body: JSON.stringify({
        email: i.email, amount: toMinor(i.amount), currency: i.currency, reference: i.reference, callback_url: i.callbackUrl,
        channels: ['card', 'mobile_money'], metadata: { order_number: i.orderNumber, cancel_action: i.cancelUrl },
      }) },
      'Paystack', this.logger,
    );
    if (!r.status) throw new BadGatewayException({ message: 'Paystack could not start this payment.', code: 'GATEWAY_ERROR' });
    return { authorizationUrl: r.data.authorization_url };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const r = await call<{ status: boolean; data: PaystackTxn }>(`${this.base}/transaction/verify/${encodeURIComponent(reference)}`, { headers: this.headers() }, 'Paystack', this.logger);
    return mapPaystackTxn(r.data);
  }

  async refund(reference: string, amount: Prisma.Decimal): Promise<RefundResult> {
    const r = await call<{ status: boolean; data: { id: number; status: string } }>(`${this.base}/refund`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ transaction: reference, amount: toMinor(amount) }),
    }, 'Paystack', this.logger);
    return { status: r.data.status === 'processed' ? 'completed' : 'pending', providerReference: String(r.data.id) };
  }

  /** Paystack signs the exact raw body with HMAC-SHA512 using the secret key (x-paystack-signature). */
  verifySignature(rawBody: Buffer, signature: string | undefined) {
    if (!signature || !this.secret) return false;
    const expected = createHmac('sha512', this.secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

// ─────────────────────────── Hubtel ───────────────────────────

@Injectable()
export class HubtelGateway implements PaymentGateway {
  readonly code = PaymentProvider.HUBTEL;
  readonly label = 'Hubtel';
  readonly detail = 'MTN MoMo, Telecel Cash, AT Money, Visa or Mastercard · via Hubtel';
  /** Hubtel Online Checkout refunds are issued from the Hubtel dashboard; Finance records the payout here. */
  readonly apiRefunds = false;
  private readonly logger = new Logger('Hubtel');

  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled() {
    return !!(this.config.get('HUBTEL_CLIENT_ID', { infer: true }) && this.config.get('HUBTEL_CLIENT_SECRET', { infer: true }) && this.config.get('HUBTEL_MERCHANT_ACCOUNT', { infer: true }));
  }
  private auth() {
    const id = this.config.get('HUBTEL_CLIENT_ID', { infer: true });
    const secret = this.config.get('HUBTEL_CLIENT_SECRET', { infer: true });
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  async initialize(i: InitInput): Promise<InitResult> {
    const api = this.config.get('API_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
    const r = await call<{ responseCode: string; status: string; data?: { checkoutUrl: string; checkoutId: string } }>('https://payproxyapi.hubtel.com/items/initiate', {
      method: 'POST',
      headers: { Authorization: this.auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalAmount: i.amount.toNumber(), description: `VÉLORA order ${i.orderNumber}`, clientReference: i.reference,
        merchantAccountNumber: this.config.get('HUBTEL_MERCHANT_ACCOUNT', { infer: true }),
        callbackUrl: `${api}/api/v1/payments/webhooks/hubtel`, returnUrl: i.callbackUrl, cancellationUrl: i.cancelUrl,
      }),
    }, 'Hubtel', this.logger);
    if (r.responseCode !== '0000' || !r.data) throw new BadGatewayException({ message: 'Hubtel could not start this payment.', code: 'GATEWAY_ERROR' });
    return { authorizationUrl: r.data.checkoutUrl, providerReference: r.data.checkoutId };
  }

  /** Hubtel callbacks are not signed, so the result is always confirmed with Hubtel's status API. */
  async verify(reference: string): Promise<VerifyResult> {
    const account = this.config.get('HUBTEL_MERCHANT_ACCOUNT', { infer: true });
    const r = await call<{ responseCode: string; data?: { status: string; amount: number; transactionId?: string; paymentMethod?: string; currencyCode?: string } }>(
      `https://api-txnstatus.hubtel.com/transactions/${encodeURIComponent(account!)}/status?clientReference=${encodeURIComponent(reference)}`,
      { headers: { Authorization: this.auth() } }, 'Hubtel', this.logger,
    );
    const d = r.data;
    const s = (d?.status ?? '').toLowerCase();
    return {
      status: s === 'paid' ? 'success' : s === 'unpaid' ? 'pending' : 'failed',
      amount: new Prisma.Decimal(d?.amount ?? 0), currency: d?.currencyCode ?? 'GHS',
      method: d?.paymentMethod?.toLowerCase().includes('card') ? PaymentMethod.CARD : d?.paymentMethod ? PaymentMethod.MOMO_MTN : undefined,
      providerReference: d?.transactionId, raw: r,
    };
  }
}

// ─────────────────────────── Simulator (development only) ───────────────────────────

/**
 * Behaves like a hosted checkout: the shopper is sent to a VÉLORA dev page, chooses Approve or Decline,
 * and the result is then confirmed through exactly the same verify → apply path as a real gateway.
 * Disabled unless PAYMENT_SIMULATOR=true, which the config refuses in production.
 */
@Injectable()
export class SimulatorGateway implements PaymentGateway {
  readonly code = PaymentProvider.SIMULATOR;
  readonly label = 'Test payment (development)';
  readonly detail = 'Simulated card / MoMo checkout. No real money moves.';
  readonly apiRefunds = true;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  get enabled() {
    return this.config.get('PAYMENT_SIMULATOR', { infer: true }) && this.config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  async initialize(i: InitInput): Promise<InitResult> {
    const web = this.config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
    const q = new URLSearchParams({ reference: i.reference, amount: i.amount.toFixed(2), order: i.orderNumber, callback: i.callbackUrl });
    return { authorizationUrl: `${web}/dev/pay-simulator?${q}`, providerReference: `SIM-${i.reference}` };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const p = await this.prisma.payment.findUnique({ where: { reference } });
    const sim = (p?.providerResponse as { simulator?: { outcome?: string; channel?: string } } | null)?.simulator;
    const status: VerifiedStatus = sim?.outcome === 'approve' ? 'success' : sim?.outcome === 'decline' ? 'failed' : 'pending';
    return {
      status, amount: p?.amount ?? new Prisma.Decimal(0), currency: p?.currency ?? 'GHS', providerReference: `SIM-${reference}`,
      method: sim?.channel === 'momo' ? PaymentMethod.MOMO_MTN : PaymentMethod.CARD,
      cardLast4: sim?.channel === 'momo' ? undefined : '4081', cardBrand: sim?.channel === 'momo' ? undefined : 'visa',
      payerPhone: sim?.channel === 'momo' ? '+233240000000' : undefined,
      failureReason: status === 'failed' ? 'Declined in simulator' : undefined, raw: { simulator: sim ?? null },
    };
  }

  async refund(reference: string): Promise<RefundResult> {
    return { status: 'completed', providerReference: `SIM-RF-${reference}` };
  }
}
