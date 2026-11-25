import { ConflictException, Global, Injectable, Module } from '@nestjs/common';
import {
  CommissionStatus, LoyaltyTxnType, OrderStatus, PaymentStatus, PaymentTxnStatus, Prisma, RefundStatus, ReturnStatus,
} from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';

export const CANCELLABLE: OrderStatus[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.PROCESSING];

/**
 * The single implementation of order state changes that touch money and stock, shared by
 * customer cancellation, staff cancellation, unpaid-order expiry and refund completion.
 * Every method runs inside the caller's transaction.
 */
@Injectable()
export class OrderLifecycleService {
  constructor(private readonly inventory: InventoryService) {}

  async cancel(tx: Prisma.TransactionClient, orderId: number, o: { by: number | null; reason: string; historyNote: string }) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: { in: CANCELLABLE } },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: o.reason, paymentDueAt: null },
    });
    if (claimed.count !== 1) throw new ConflictException({ message: 'This order can no longer be cancelled', code: 'NOT_CANCELLABLE' });

    await this.inventory.releaseForOrder(tx, orderId, o.by, o.historyNote);
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: OrderStatus.CANCELLED, note: o.historyNote, changedBy: o.by } });
    await tx.payment.updateMany({ where: { orderId, status: { in: [PaymentTxnStatus.INITIATED, PaymentTxnStatus.PENDING] } }, data: { status: PaymentTxnStatus.ABANDONED } });
    await tx.vendorCommission.updateMany({ where: { orderItem: { orderId } }, data: { status: CommissionStatus.REVERSED } });
    if (order.couponId) {
      const deleted = await tx.couponRedemption.deleteMany({ where: { orderId } });
      if (deleted.count) await tx.$executeRaw`UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = ${order.couponId}`;
    }
    // Money already collected online goes back to the customer through Finance.
    if (order.paymentStatus === PaymentStatus.PAID) {
      const open = await tx.refund.count({ where: { orderId, status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSING] } } });
      if (!open) {
        const payment = await tx.payment.findFirst({ where: { orderId, status: PaymentTxnStatus.SUCCESS }, orderBy: { createdAt: 'desc' } });
        await tx.refund.create({ data: { orderId, paymentId: payment?.id, amount: order.grandTotal.sub(order.refundedTotal), reason: `Order cancelled: ${o.reason}`, status: RefundStatus.REQUESTED } });
      }
    }
    if (order.userId && order.status !== OrderStatus.PENDING_PAYMENT) {
      await tx.customer.updateMany({ where: { userId: order.userId, orderCount: { gt: 0 } }, data: { orderCount: { decrement: 1 } } });
    }
  }

  /**
   * Books a completed refund against the order: refunded totals, payment/order status,
   * return closure, vendor commission reversal and a proportional loyalty clawback.
   */
  async completeRefund(tx: Prisma.TransactionClient, refundId: number, by: number | null, providerReference?: string) {
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { return: { include: { items: true } } } });
    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSING] } },
      data: { status: RefundStatus.COMPLETED, processedAt: new Date(), processedById: by ?? undefined, providerReference },
    });
    if (claimed.count !== 1) return false; // already completed (e.g. webhook after manual completion)

    const order = await tx.order.findUniqueOrThrow({ where: { id: refund.orderId } });
    const refunded = order.refundedTotal.add(refund.amount);
    const full = refunded.gte(order.grandTotal);
    const nextStatus = order.status === OrderStatus.CANCELLED ? OrderStatus.CANCELLED : full ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED;
    await tx.order.update({
      where: { id: order.id },
      data: { refundedTotal: refunded, paymentStatus: full ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED, status: nextStatus },
    });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: nextStatus, note: `Refund of GH₵${refund.amount.toFixed(2)} completed${providerReference ? ` (${providerReference})` : ''}`, changedBy: by },
    });

    if (refund.return) {
      await tx.return.update({ where: { id: refund.return.id }, data: { status: ReturnStatus.REFUNDED, closedAt: new Date() } });
      await tx.vendorCommission.updateMany({ where: { orderItemId: { in: refund.return.items.map((i) => i.orderItemId) } }, data: { status: CommissionStatus.REVERSED } });
    }

    // Lifetime value and loyalty only ever counted delivered merchandise, so only claw back what was granted.
    if (order.userId && (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETED || order.status === OrderStatus.PARTIALLY_REFUNDED)) {
      await tx.customer.updateMany({ where: { userId: order.userId }, data: { lifetimeValue: { decrement: refund.amount } } });
      const earned = await tx.loyaltyTransaction.aggregate({ where: { orderId: order.id, type: LoyaltyTxnType.EARN }, _sum: { points: true } });
      const earnedPts = earned._sum.points ?? 0;
      if (earnedPts > 0) {
        const merch = order.grandTotal.sub(order.shippingTotal);
        const claw = Math.min(earnedPts, Math.floor(merch.isZero() ? 0 : (earnedPts * Number(refund.amount)) / Number(merch)));
        const acct = await tx.loyaltyAccount.findUnique({ where: { userId: order.userId } });
        if (acct && claw > 0) {
          const take = Math.min(claw, acct.pointsBalance);
          const after = await tx.loyaltyAccount.update({ where: { id: acct.id }, data: { pointsBalance: { decrement: take } } });
          await tx.loyaltyTransaction.create({ data: { accountId: acct.id, type: LoyaltyTxnType.REVERSAL, points: -take, balanceAfter: after.pointsBalance, orderId: order.id, description: `Refund on ${order.orderNumber}` } });
        }
      }
    }
    return true;
  }
}

@Global()
@Module({ providers: [OrderLifecycleService], exports: [OrderLifecycleService] })
export class OrderLifecycleModule {}
