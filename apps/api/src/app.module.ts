import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.service';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PlatformModule } from './modules/settings/settings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { CustomerModule } from './modules/customer/customer.module';
import { InventoryModule } from './modules/inventory/inventory.service';
import { UploadsModule } from './modules/uploads/uploads.module';
import { AdminDashboardModule } from './modules/admin/admin-dashboard.module';
import { AdminCatalogModule } from './modules/admin/admin-catalog.module';
import { AdminOrdersModule } from './modules/admin/admin-orders.module';
import { AdminInventoryModule } from './modules/admin/admin-inventory.module';
import { AdminCustomersModule } from './modules/admin/admin-customers.module';
import { OrderLifecycleModule } from './modules/orders/order-lifecycle.service';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { VendorPortalModule } from './modules/vendors/vendor-portal.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AdminAnalyticsModule } from './modules/admin/admin-analytics.module';
import { JwtAuthGuard, PermissionsGuard } from './common/guards/auth.guards';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';

/**
 * Modular monolith. Each feature lives in src/modules/<name> and talks to others only through
 * exported services, so a module can later be extracted into its own service.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PlatformModule,
    CatalogModule,
    CartModule,
    CheckoutModule,
    CustomerModule,
    InventoryModule,
    OrderLifecycleModule,
    PaymentsModule,
    ReturnsModule,
    NotificationsModule,
    VendorsModule,
    VendorPortalModule,
    LoyaltyModule,
    PromotionsModule,
    ReviewsModule,
    AdminAnalyticsModule,
    UploadsModule,
    AdminDashboardModule,
    AdminCatalogModule,
    AdminOrdersModule,
    AdminInventoryModule,
    AdminCustomersModule,
  ],
  providers: [
    // Order matters: rate-limit → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
