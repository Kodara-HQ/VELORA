import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap,
  OnModuleDestroy, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentMethod, PaymentProvider, PaymentStatus, PaymentTxnStatus, Prisma, RefundStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { MessagingService } from '../notifications/messaging.service';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import type { Env } from '../../config/env';
import type { ViewerRef } from '../../common/viewer';
import { HubtelGateway, mapPaystackTxn, PaystackGateway, scrub, SimulatorGateway, type PaymentGateway, type VerifyResult } from './gateways';

export type OnlineProvider = 'PAYSTACK' | 'HUBTEL' | 'SIMULATOR';
export const ONLINE_PROVIDERS: OnlineProvider[] = ['PAYSTACK', 'HUBTEL', 'SIMULATOR'];

export interface NextAction { type: 'redirect'; url: string; reference: string; provider: OnlineProvider }

@Injectable()
export class PaymentsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly lifecycle: OrderLifecycleService,
    readonly paystack: PaystackGateway,
    private readonly hubtel: HubtelGateway,
    private readonly simulator: SimulatorGateway,
    private readonly messaging: MessagingService,
  ) {}

  // ─── Gateways ───

  gateway(code: PaymentProvider): PaymentGateway | null {
    if (code === 'PAYSTACK' && this.paystack.enabled) return this.paystack;
    if (code === 'HUBTEL' && this.hubtel.enabled) return this.hubtel;
    if (code === 'SIMULATOR' && this.simulator.enabled) return this.simulator;
    return null;
  }

  /** Methods offered at checkout, in display order. Pay on delivery is always available. */
  methods() {
    const online = ONLINE_PROVIDERS.map((c) => this.gateway(c)).filter((g): g is PaymentGateway => !!g)
      .map((g) => ({ code: g.code, label: g.label, detail: g.detail, online: true }));
    return [...online, { code: 'CASH_ON_DELIVERY' as const, label: 'Pay on delivery', detail: 'Cash or MoMo to the rider when your order arrives', online: false }];
  }

  ttlMinutes() {
    return this.config.get('PAYMENT_TTL_MINUTES', { infer: true });
  }

  // ─── Starting a payment ───

  /** Creates a payment attempt and gets the hosted-checkout URL. Called after the order transaction commits. */
  async start(orderId: number, provider: OnlineProvider): Promise<NextAction> {
    const gw = this.gateway(provider);
    if (!gw) throw new BadRequestException({ message: 'That payment method is not available', code: 'PAYMENT_METHOD_UNAVAILABLE' });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { user: { select: { email: true } } } });
    if (order.status !== OrderStatus.PENDING_PAYMENT) throw new ConflictException({ message: 'This order does not need payment', code: 'NOT_PAYABLE' });

    const reference = `VLP${order.orderNumber.slice(2)}${randomBytes(4).toString('hex').toUpperCase()}`;
    const payment = await this.prisma.payment.create({
      data: { orderId, provider: gw.code, method: PaymentMethod.ONLINE, reference, amount: order.grandTotal, currency: order.currency, status: PaymentTxnStatus.INITIATED },
    });
    const web = this.config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
    try {
      const init = await gw.initialize({
        reference, amount: order.grandTotal, currency: order.currency, email: order.user?.email ?? order.guestEmail ?? 'customer@velora.test',
        orderNumber: order.orderNumber,
        callbackUrl: `${web}/order/${order.orderNumber}/payment?reference=${reference}`,
        cancelUrl: `${web}/order/${order.orderNumber}/payment?reference=${reference}&cancelled=1`,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentTxnStatus.PENDING, providerReference: init.providerReference, providerResponse: { authorizationUrl: init.authorizationUrl } },
      });
      return { type: 'redirect', url: init.authorizationUrl, reference, provider };
    } catch (e) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentTxnStatus.FAILED, failureReason: 'Could not reach the payment provider' } });
      throw e;
    }
  }

  /** For a retried checkout: the still-open hosted checkout for this order, if any. */
  async openAction(orderId: number): Promise<NextAction | null> {
    const p = await this.prisma.payment.findFirst({
      where: { orderId, status: PaymentTxnStatus.PENDING, provider: { in: ONLINE_PROVIDERS } },
      orderBy: { createdAt: 'desc' },
    });
    const url = (p?.providerResponse as { authorizationUrl?: string } | null)?.authorizationUrl;
    return p && url ? { type: 'redirect', url, reference: p.reference, provider: p.provider as OnlineProvider } : null;
  }

  /** "Pay now" on an unpaid order (after a failed or abandoned attempt). Guests prove ownership with the order email. */
  async payAgain(v: ViewerRef, orderNumber: string, provider: OnlineProvider, email?: string) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber } });
    if (!order) throw new NotFoundException('Order not found');
    const mine = v.userId ? order.userId === v.userId : !order.userId && !!email && order.guestEmail === email.trim().toLowerCase();
    if (!mine) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PENDING_PAYMENT) throw new ConflictException({ message: 'This order does not need payment', code: 'NOT_PAYABLE' });
    if (order.paymentDueAt && order.paymentDueAt < new Date()) throw new ConflictException({ message: 'The payment window for this order has closed', code: 'PAYMENT_EXPIRED' });
    await this.prisma.payment.updateMany({ where: { orderId: order.id, status: PaymentTxnStatus.PENDING }, data: { status: PaymentTxnStatus.ABANDONED } });
    return this.start(order.id, provider);
  }

  // ─── Confirming a payment ───

  /** Return-from-gateway check: asks the provider directly, never trusts query parameters. */
  async verifyReference(reference: string) {
    const p = await this.prisma.payment.findUnique({ where: { reference }, include: { order: { select: { orderNumber: true } } } });
    if (!p) throw new NotFoundException('Payment not found');
    if (p.status === PaymentTxnStatus.INITIATED || p.status === PaymentTxnStatus.PENDING) {
      const gw = this.gateway(p.provider);
      if (gw) await this.apply(p.id, await gw.verify(reference), 'verify');
    }
    return this.status(reference);
  }

  async status(reference: string) {
    const p = await this.prisma.payment.findUniqueOrThrow({
      where: { reference },
      include: { order: { select: { orderNumber: true, status: true, paymentStatus: true, paymentDueAt: true } } },
    });
    return {
      reference, status: p.status, failureReason: p.failureReason, provider: p.provider,
      orderNumber: p.order.orderNumber, orderStatus: p.order.status, orderPaymentStatus: p.order.paymentStatus, paymentDueAt: p.order.paymentDueAt,
    };
  }

  /**
   * Applies a provider-confirmed result exactly once. Amount and currency must match what we asked for;
   * the conditional status update makes concurrent webhook + redirect + sweeper calls safe.
   */
  async apply(paymentId: number, r: VerifyResult, source: 'webhook' | 'verify' | 'sweep') {
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
    if (r.status === 'pending') return false;

    if (r.status === 'success' && (!r.amount.eq(p.amount) || r.currency.toUpperCase() !== p.currency)) {
      await this.prisma.payment.updateMany({
        where: { id: p.id, status: { in: [PaymentTxnStatus.INITIATED, PaymentTxnStatus.PENDING] } },
        data: { status: PaymentTxnStatus.FAILED, failureReason: `Amount mismatch: expected ${p.currency} ${p.amount.toFixed(2)}, provider reported ${r.currency} ${r.amount.toFixed(2)}`, providerResponse: scrub(r.raw) },
      });
      await this.audit.log({ userId: null, action: 'payments.amount_mismatch', entityType: 'payment', entityId: p.reference, newValues: { expected: p.amount.toFixed(2), reported: r.amount.toFixed(2), currency: r.currency, source } });
      this.logger.warn(`Amount mismatch on ${p.reference} (${source})`);
      return false;
    }

    if (r.status !== 'success') {
      await this.prisma.payment.updateMany({
        where: { id: p.id, status: { in: [PaymentTxnStatus.INITIATED, PaymentTxnStatus.PENDING] } },
        data: { status: r.status === 'abandoned' ? PaymentTxnStatus.ABANDONED : PaymentTxnStatus.FAILED, failureReason: r.failureReason ?? 'Payment was not completed', providerResponse: scrub(r.raw) },
      });
      return false;
    }

    return this.prisma.$transaction(async (tx) => {
      // A provider "success" outranks an earlier failed/abandoned read of the same attempt.
      const claimed = await tx.payment.updateMany({
        where: { id: p.id, status: { in: [PaymentTxnStatus.INITIATED, PaymentTxnStatus.PENDING, PaymentTxnStatus.FAILED, PaymentTxnStatus.ABANDONED] } },
        data: {
          status: PaymentTxnStatus.SUCCESS, verifiedAt: new Date(), method: r.method ?? PaymentMethod.CARD,
          providerReference: r.providerReference ?? p.providerReference, cardLast4: r.cardLast4, cardBrand: r.cardBrand, payerPhone: r.payerPhone,
          failureReason: null, providerResponse: scrub(r.raw),
        },
      });
      if (claimed.count !== 1) return false; // already applied

      const order = await tx.order.findUniqueOrThrow({ where: { id: p.orderId } });
      const label = `${p.provider === 'PAYSTACK' ? 'Paystack' : p.provider === 'HUBTEL' ? 'Hubtel' : 'test gateway'}`;
      if (order.status === OrderStatus.PENDING_PAYMENT) {
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID, paymentStatus: PaymentStatus.PAID, paidAt: new Date(), paymentDueAt: null } });
        await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: OrderStatus.PAID, note: `Payment confirmed by ${label}` } });
        await this.messaging.orderEvent(tx, order.id, 'paid');
        if (order.userId) await tx.customer.updateMany({ where: { userId: order.userId }, data: { orderCount: { increment: 1 }, lastOrderAt: new Date() } });
      } else {
        // Paid after the order expired or was cancelled (or a second payment for a paid order): refund it.
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: order.paymentStatus === PaymentStatus.UNPAID || order.paymentStatus === PaymentStatus.PENDING ? PaymentStatus.PAID : order.paymentStatus } });
        await tx.refund.create({ data: { orderId: order.id, paymentId: p.id, amount: p.amount, reason: order.status === OrderStatus.CANCELLED ? 'Payment received after the order was cancelled' : 'Duplicate payment', status: RefundStatus.REQUESTED } });
        await this.audit.log({ userId: null, action: 'payments.late_or_duplicate', entityType: 'payment', entityId: p.reference, newValues: { orderStatus: order.status } }, tx);
      }
      await tx.payment.updateMany({ where: { orderId: order.id, id: { not: p.id }, status: { in: [PaymentTxnStatus.INITIATED, PaymentTxnStatus.PENDING] } }, data: { status: PaymentTxnStatus.ABANDONED } });
      await this.audit.log({ userId: null, action: 'payments.succeeded', entityType: 'payment', entityId: p.reference, newValues: { amount: p.amount.toFixed(2), provider: p.provider, source } }, tx);
      return true;
    });
  }

  // ─── Webhooks ───

  private async recordEvent(provider: PaymentProvider, eventId: string, eventType: string, payload: unknown) {
    try {
      return await this.prisma.webhookEvent.create({ data: { provider, eventId: eventId.slice(0, 128), eventType: eventType.slice(0, 80), payload: scrub(payload), signatureOk: true } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // delivered before: ignore
      throw e;
    }
  }

  async paystackWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!this.paystack.enabled) throw new ForbiddenException('Paystack is not configured');
    if (!rawBody || !this.paystack.verifySignature(rawBody, signature)) {
      this.logger.warn('Rejected Paystack webhook with an invalid signature');
      throw new UnauthorizedException('Invalid signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as { event: string; data: Record<string, unknown> };
    const eventId = `${body.event}:${String(body.data?.id ?? body.data?.reference ?? '')}`;
    const ev = await this.recordEvent(PaymentProvider.PAYSTACK, eventId, body.event, body);
    if (!ev) return { received: true, duplicate: true };

    try {
      if (body.event === 'charge.success') {
        const result = mapPaystackTxn(body.data as never);
        const p = await this.prisma.payment.findUnique({ where: { reference: String(body.data.reference) } });
        if (p) await this.apply(p.id, result, 'webhook');
      } else if (body.event === 'refund.processed') {
        const ref = String((body.data as { transaction_reference?: string }).transaction_reference ?? '');
        const refund = await this.prisma.refund.findFirst({ where: { payment: { reference: ref }, status: RefundStatus.PROCESSING }, orderBy: { createdAt: 'asc' } });
        if (refund) await this.prisma.$transaction((tx) => this.lifecycle.completeRefund(tx, refund.id, null, String(body.data.id ?? '')));
      }
      await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
    } catch (e) {
      await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { error: (e as Error).message.slice(0, 500) } });
      throw e;
    }
    return { received: true };
  }

  /** Hubtel callbacks are unsigned: the payload only tells us which payment to re-check with Hubtel's API. */
  async hubtelCallback(body: { Data?: { ClientReference?: string; CheckoutId?: string }; Status?: string }) {
    const reference = body?.Data?.ClientReference;
    if (!reference || !this.hubtel.enabled) return { received: true };
    const ev = await this.recordEvent(PaymentProvider.HUBTEL, `${reference}:${body.Data?.CheckoutId ?? ''}:${body.Status ?? ''}`, `callback.${body.Status ?? 'unknown'}`, body);
    if (!ev) return { received: true, duplicate: true };
    const p = await this.prisma.payment.findUnique({ where: { reference } });
    if (p && p.provider === 'HUBTEL') await this.apply(p.id, await this.hubtel.verify(reference), 'webhook');
    await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
    return { received: true };
  }

  /** Dev simulator: records the shopper's choice, then confirms it through the normal verify path. */
  async simulate(reference: string, outcome: 'approve' | 'decline', channel: 'card' | 'momo') {
    if (!this.simulator.enabled) throw new NotFoundException();
    const p = await this.prisma.payment.findUnique({ where: { reference } });
    if (!p || p.provider !== 'SIMULATOR') throw new NotFoundException('Payment not found');
    const current = (p.providerResponse as Record<string, unknown> | null) ?? {};
    await this.prisma.payment.update({ where: { id: p.id }, data: { providerResponse: { ...current, simulator: { outcome, channel } } as Prisma.InputJsonValue } });
    return this.verifyReference(reference);
  }

  // ─── Expiry sweeper ───

  onApplicationBootstrap() {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return; // tests call sweep() directly
    this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(`Payment sweep failed: ${(e as Error).message}`)), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Unpaid online orders past their payment window: re-check the provider once (a webhook may have been
   * missed), then cancel and release the reserved stock. Safe to run on several instances at once.
   */
  async sweep(now = new Date()) {
    if (this.sweeping) return { checked: 0, paid: 0, cancelled: 0 };
    this.sweeping = true;
    let paid = 0;
    let cancelled = 0;
    try {
      const due = await this.prisma.order.findMany({
        where: { status: OrderStatus.PENDING_PAYMENT, paymentDueAt: { lt: now } },
        select: { id: true, orderNumber: true }, take: 50, orderBy: { paymentDueAt: 'asc' },
      });
      for (const o of due) {
        const open = await this.prisma.payment.findMany({ where: { orderId: o.id, status: { in: [PaymentTxnStatus.INITIATED, PaymentTxnStatus.PENDING] } } });
        for (const p of open) {
          const gw = this.gateway(p.provider);
          if (!gw) continue;
          try {
            if (await this.apply(p.id, await gw.verify(p.reference), 'sweep')) paid++;
          } catch (e) {
            this.logger.warn(`Could not re-check ${p.reference}: ${(e as Error).message}`);
          }
        }
        try {
          await this.prisma.$transaction((tx) => this.lifecycle.cancel(tx, o.id, {
            by: null, reason: 'Payment not received in time', historyNote: 'Cancelled automatically: payment was not completed in time. Reserved items were released.',
          }));
          cancelled++;
        } catch (e) {
          if (!(e instanceof ConflictException)) throw e; // paid in the meantime
        }
      }
      return { checked: due.length, paid, cancelled };
    } finally {
      this.sweeping = false;
    }
  }
}
