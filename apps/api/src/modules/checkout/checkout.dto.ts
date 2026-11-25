import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { GHANA_REGIONS } from '@velora/shared';
import { GH_PHONE_RULE } from '../auth/dto/auth.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const phone = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value);
const PHONE_MSG = 'Enter a Ghana mobile number like +233241234567';

export class AddressInput {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(50)
  label?: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2, { message: 'Enter the recipient’s full name' }) @MaxLength(150)
  recipientName: string;

  @ApiProperty() @Transform(phone) @Matches(GH_PHONE_RULE, { message: PHONE_MSG })
  phone: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(3, { message: 'Enter a street address or house number' }) @MaxLength(255)
  line1: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255)
  line2?: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2, { message: 'Enter a town or area' }) @MaxLength(100)
  city: string;

  @ApiProperty({ enum: GHANA_REGIONS }) @IsIn(GHANA_REGIONS as unknown as string[], { message: 'Choose a region' })
  region: string;

  @ApiPropertyOptional({ example: 'GA-183-8164' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))
  @Matches(/^[A-Z]{2}-\d{3,4}-\d{3,4}$/, { message: 'GhanaPost GPS looks like GA-183-8164' })
  digitalAddress?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(255)
  landmark?: string;
}

export class ContactInput {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(191)
  email: string;

  @ApiProperty() @Transform(phone) @Matches(GH_PHONE_RULE, { message: PHONE_MSG })
  phone: string;
}

export class QuoteDto {
  @ApiProperty({ enum: GHANA_REGIONS }) @IsIn(GHANA_REGIONS as unknown as string[], { message: 'Choose a region' })
  region: string;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  shippingMethodId?: number;

  @ApiPropertyOptional({ description: 'Guest email, so first-order and per-customer coupon rules can be checked' })
  @IsOptional() @IsEmail() @MaxLength(191)
  email?: string;
}

/** Accepted values. Whether an online provider is actually configured is checked when the order is placed. */
export const PAYMENT_METHODS_AVAILABLE = ['CASH_ON_DELIVERY', 'PAYSTACK', 'HUBTEL', 'SIMULATOR'] as const;

export class PlaceOrderDto {
  @ApiPropertyOptional({ description: 'Required for guests; optional override for signed-in customers' })
  @IsOptional() @ValidateNested() @Type(() => ContactInput)
  contact?: ContactInput;

  @ApiPropertyOptional({ description: 'A saved address (signed-in customers)' })
  @IsOptional() @IsInt()
  addressId?: number;

  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => AddressInput)
  address?: AddressInput;

  @ApiPropertyOptional({ description: 'Save the new address to the account' })
  @IsOptional() @IsBoolean()
  saveAddress?: boolean;

  @ApiProperty() @IsInt()
  shippingMethodId: number;

  @ApiProperty({ enum: PAYMENT_METHODS_AVAILABLE }) @IsIn(PAYMENT_METHODS_AVAILABLE as unknown as string[], { message: 'Choose a payment method' })
  paymentMethod: (typeof PAYMENT_METHODS_AVAILABLE)[number];

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Total the shopper saw; if prices changed the order is refused (409 PRICE_CHANGED)' })
  @IsOptional() @Matches(/^\d+(\.\d{1,2})?$/)
  expectedTotal?: string;
}

export class LookupDto {
  @ApiProperty() @Transform(trim) @IsString() @Matches(/^VL[0-9A-Z-]{6,28}$/i, { message: 'Enter your order number, e.g. VL2611241A2B3' })
  orderNumber: string;

  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail()
  email: string;
}
