import { Body, Controller, Get, Global, Headers, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { Viewer, type ViewerRef } from '../../common/viewer';
import { HubtelGateway, PaystackGateway, SimulatorGateway } from './gateways';
import { ONLINE_PROVIDERS, PaymentsService, type OnlineProvider } from './payments.service';

const REF = /^VLP[0-9A-Z]{8,40}$/;

class VerifyDto {
  @ApiProperty() @IsString() @Matches(REF, { message: 'Invalid payment reference' }) reference: string;
}

class PayDto {
  @ApiProperty({ enum: ONLINE_PROVIDERS }) @IsIn(ONLINE_PROVIDERS) provider: OnlineProvider;
  @ApiPropertyOptional({ description: 'Guests: the email used at checkout' }) @IsOptional() @IsEmail() @MaxLength(191) email?: string;
}

class SimulateDto {
  @ApiProperty({ enum: ['approve', 'decline'] }) @IsIn(['approve', 'decline']) outcome: 'approve' | 'decline';
  @ApiPropertyOptional({ enum: ['card', 'momo'] }) @IsOptional() @IsIn(['card', 'momo']) channel: 'card' | 'momo' = 'card';
}

@ApiTags('Payments')
@Public()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('checkout/payment-methods')
  methods() {
    return this.payments.methods();
  }

  /** Called by the payment-return page. The server asks the provider; the browser's word is never taken. */
  @Post('payments/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Body() dto: VerifyDto) {
    return this.payments.verifyReference(dto.reference);
  }

  @Post('orders/:number/pay')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pay(@Viewer() v: ViewerRef, @Param('number') n: string, @Body() dto: PayDto) {
    return this.payments.payAgain(v, n, dto.provider, dto.email);
  }

  @Post('payments/webhooks/paystack')
  @HttpCode(200)
  @SkipThrottle()
  @ApiExcludeEndpoint()
  paystack(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') sig?: string) {
    return this.payments.paystackWebhook(req.rawBody, sig);
  }

  @Post('payments/webhooks/hubtel')
  @HttpCode(200)
  @SkipThrottle()
  @ApiExcludeEndpoint()
  hubtel(@Body() body: Record<string, unknown>) {
    return this.payments.hubtelCallback(body as never);
  }

  @Post('payments/simulator/:reference')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  simulate(@Param('reference') reference: string, @Body() dto: SimulateDto) {
    return this.payments.simulate(reference, dto.outcome, dto.channel);
  }
}

@Global()
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaystackGateway, HubtelGateway, SimulatorGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
