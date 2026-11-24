import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** 10+ chars, at least one letter and one number. Long passphrases are welcome. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;
export const PASSWORD_MESSAGE = 'Password must be 10–128 characters and include at least one letter and one number';
/** Ghana mobile numbers in E.164, e.g. +233241234567 */
export const GH_PHONE_RULE = /^\+233[2-5]\d{8}$/;

export class RegisterDto {
  @ApiProperty() @Transform(lower) @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(191)
  email: string;

  @ApiProperty({ minLength: 10 }) @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(1, { message: 'First name is required' }) @MaxLength(100)
  firstName: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(1, { message: 'Last name is required' }) @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: '+233241234567' })
  @IsOptional() @Transform(trim) @Matches(GH_PHONE_RULE, { message: 'Enter a Ghana mobile number like +233241234567' })
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  marketingOptIn?: boolean;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(20)
  referralCode?: string;
}

export class LoginDto {
  @ApiProperty() @Transform(lower) @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @ApiProperty() @IsString() @MinLength(1, { message: 'Password is required' }) @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Mobile clients only. Web clients use the httpOnly cookie.' })
  @IsOptional() @IsString() @MaxLength(200)
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @Transform(lower) @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200)
  token: string;

  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(128)
  currentPassword: string;

  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}
