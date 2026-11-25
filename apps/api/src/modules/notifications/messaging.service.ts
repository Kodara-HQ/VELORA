import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, OutboxStatus, Prisma } from '@prisma/client';
import { createTransport, type Transporter } from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import type { NotifyInput } from './notifications.module';

type Tx = Prisma.TransactionClient;

export type OrderEvent = 'placed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

/** What a customer has chosen to receive. Order updates default on; marketing defaults to their sign-up choice. */
export interface NotificationPrefs { email: { orders: boolean; marketing: boolean }; sms: { orders: boolean; marketing: boolean } }
export const defaultPrefs = (marketing = false): NotificationPrefs => ({ email: { orders: true, marketing }, sms: { orders: true, marketing: false } });
export function readPrefs(raw: unknown, marketing = false): NotificationPrefs {
  const d = defaultPrefs(marketing);
  const r = (raw ?? {}) as Partial<NotificationPrefs>;
  return { email: { ...d.email, ...r.email }, sms: { ...d.sms, ...r.sms } };
}

const MAX_ATTEMPTS = 5;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Email and SMS go through an outbox table: the business action only inserts a row (inside its own
 * transaction, so a rolled-back order never sends a message), and a background worker delivers it
 * with retries and back-off. Drivers: "log" for development, SMTP for email, Hubtel for SMS.
 */
@Injectable()
export class MessagingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private mailer: Transporter | null = null;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const url = config.get<string>('SMTP_URL');
    if (config.get('MAIL_DRIVER') === 'smtp' && url) this.mailer = createTransport(url);
  }

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.flush().catch((e) => this.logger.error('Outbox worker failed', e as Error)), 30_000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private get web() { return this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000'; }

  async queue(tx: Tx, m: { channel: 'EMAIL' | 'SMS'; recipient: string; userId?: number | null; template: string; subject?: string; body: string }) {
    await tx.messageOutbox.create({ data: { ...m, channel: m.channel as NotificationChannel, subject: m.subject?.slice(0, 200), userId: m.userId ?? null } });
  }

  /** Order updates by email and SMS (per the customer's preferences) plus the in-app bell for account holders. */
  async orderEvent(tx: Tx, orderId: number, event: OrderEvent, extra?: { note?: string }) {
    const o = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, userId: true, guestEmail: true, guestPhone: true, grandTotal: true, refundedTotal: true,
        user: { select: { email: true, phone: true, firstName: true, customer: { select: { notificationPrefs: true, marketingOptIn: true } } } },
        shipments: { select: { carrier: true, trackingNumber: true }, take: 1, orderBy: { id: 'desc' } } },
    });
    if (!o) return;
    const name = o.user?.firstName ?? 'there';
    const prefs = readPrefs(o.user?.customer?.notificationPrefs, o.user?.customer?.marketingOptIn);
    const link = o.userId ? `${this.web}/account/orders/${o.orderNumber}` : `${this.web}/track-order`;
    const total = `GH₵${o.grandTotal.toFixed(2)}`;
    const ship = o.shipments[0];
    const copy: Record<OrderEvent, { subject: string; line: string; sms: string }> = {
      placed: { subject: `Order ${o.orderNumber} confirmed`, line: `Thank you for your order. We're getting it ready. Total ${total}, payable on delivery.`, sms: `VELORA: Order ${o.orderNumber} confirmed (${total}, pay on delivery). Track: ${link}` },
      paid: { subject: `Order ${o.orderNumber} confirmed`, line: `We've received your payment of ${total} and we're getting your order ready.`, sms: `VELORA: Payment received. Order ${o.orderNumber} is being prepared. ${link}` },
      shipped: { subject: `Order ${o.orderNumber} is on its way`, line: `Your order has been dispatched${ship ? ` with ${ship.carrier}${ship.trackingNumber ? ` (tracking ${ship.trackingNumber})` : ''}` : ''}.`, sms: `VELORA: Order ${o.orderNumber} is on its way. Track: ${link}` },
      delivered: { subject: `Order ${o.orderNumber} delivered`, line: 'Your order has been delivered. We hope you love it. You can review your pieces from your account.', sms: `VELORA: Order ${o.orderNumber} delivered. Enjoy!` },
      cancelled: { subject: `Order ${o.orderNumber} cancelled`, line: `Your order has been cancelled.${extra?.note ? ` ${extra.note}` : ''} Any payment will be refunded.`, sms: `VELORA: Order ${o.orderNumber} was cancelled. Any payment will be refunded.` },
      refunded: { subject: `Refund for order ${o.orderNumber}`, line: `We've refunded ${extra?.note ?? 'your payment'}. It can take a few days to reach your account.`, sms: `VELORA: Refund processed for order ${o.orderNumber}${extra?.note ? ` (${extra.note})` : ''}.` },
    };
    const c = copy[event];
    const email = o.user?.email ?? o.guestEmail;
    const phone = o.user?.phone ?? o.guestPhone;
    if (email && prefs.email.orders) {
      await this.queue(tx, { channel: 'EMAIL', recipient: email, userId: o.userId, template: `order.${event}`, subject: c.subject, body: this.html(`Hi ${name},`, c.line, 'View your order', link) });
    }
    if (phone && prefs.sms.orders && event !== 'paid') {
      await this.queue(tx, { channel: 'SMS', recipient: phone, userId: o.userId, template: `order.${event}`, body: c.sms });
    }
    if (o.userId) {
      const n: NotifyInput = { type: `order.${event}`, title: c.subject, body: c.line, data: { href: `/account/orders/${o.orderNumber}` } };
      await tx.notification.create({ data: { userId: o.userId, channel: NotificationChannel.IN_APP, type: n.type, title: n.title, body: n.body, data: n.data, sentAt: new Date() } });
    }
  }

  html(greeting: string, line: string, cta?: string, href?: string) {
    return `<!doctype html><html><body style="margin:0;background:#F8F7F4;font-family:Inter,Arial,sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E6E3DD">
<tr><td style="background:#111111;color:#FFFFFF;padding:20px 28px;font-family:Manrope,Arial,sans-serif;font-weight:800;letter-spacing:.3em">VÉLORA</td></tr>
<tr><td style="padding:28px"><p style="margin:0 0 12px;font-size:16px">${esc(greeting)}</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6">${esc(line)}</p>
${cta && href ? `<a href="${esc(href)}" style="display:inline-block;background:#111111;color:#FFFFFF;text-decoration:none;padding:12px 22px;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase">${esc(cta)}</a>` : ''}
</td></tr><tr><td style="padding:18px 28px;border-top:1px solid #E6E3DD;font-size:12px;color:#777777">DEFINE YOUR STYLE. · You're receiving this because of activity on your VÉLORA account. Manage emails in your account settings.</td></tr>
</table></td></tr></table></body></html>`;
  }

  /** Delivers due messages. Runs every 30 seconds; safe to run concurrently (each row is claimed first). */
  async flush(limit = 25) {
    if (this.running) return { sent: 0, failed: 0 };
    this.running = true;
    let sent = 0;
    let failed = 0;
    try {
      const due = await this.prisma.messageOutbox.findMany({ where: { status: OutboxStatus.PENDING, nextAttemptAt: { lte: new Date() } }, orderBy: { id: 'asc' }, take: limit });
      for (const m of due) {
        // Claim by bumping attempts, so two workers never send the same message.
        const claimed = await this.prisma.messageOutbox.updateMany({ where: { id: m.id, status: OutboxStatus.PENDING, attempts: m.attempts }, data: { attempts: { increment: 1 } } });
        if (claimed.count !== 1) continue;
        try {
          if (m.channel === NotificationChannel.EMAIL) await this.sendEmail(m.recipient, m.subject ?? 'VÉLORA', m.body);
          else await this.sendSms(m.recipient, m.body);
          await this.prisma.messageOutbox.update({ where: { id: m.id }, data: { status: OutboxStatus.SENT, sentAt: new Date(), lastError: null } });
          sent++;
        } catch (e) {
          const attempts = m.attempts + 1;
          const final = attempts >= MAX_ATTEMPTS;
          await this.prisma.messageOutbox.update({
            where: { id: m.id },
            data: { status: final ? OutboxStatus.FAILED : OutboxStatus.PENDING, lastError: (e as Error).message.slice(0, 500), nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000) },
          });
          failed++;
        }
      }
    } finally {
      this.running = false;
    }
    return { sent, failed };
  }

  private async sendEmail(to: string, subject: string, html: string) {
    if (!this.mailer) {
      this.logger.log(`[email:log] to=${to} subject="${subject}"`);
      return;
    }
    await this.mailer.sendMail({ from: this.config.get<string>('MAIL_FROM'), to, subject, html });
  }

  private async sendSms(to: string, content: string) {
    if (this.config.get('SMS_DRIVER') !== 'hubtel') {
      this.logger.log(`[sms:log] to=${to} "${content}"`);
      return;
    }
    const id = this.config.get<string>('HUBTEL_SMS_CLIENT_ID')!;
    const secret = this.config.get<string>('HUBTEL_SMS_CLIENT_SECRET')!;
    const r = await fetch('https://smsc.hubtel.com/v1/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
      body: JSON.stringify({ From: this.config.get<string>('SMS_SENDER_ID'), To: to.replace(/^\+/, ''), Content: content.slice(0, 459) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Hubtel SMS ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}
