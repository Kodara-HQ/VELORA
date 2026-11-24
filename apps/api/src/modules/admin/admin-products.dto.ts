import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ProductStatus } from '@prisma/client';
import { PaginationQuery } from '../../common/dto/pagination.dto';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MSG = 'Enter an amount like 249.00';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndef = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value);

export class StockInput {
  @ApiProperty() @IsInt() warehouseId: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) quantity: number;
}

export class VariantInput {
  @ApiPropertyOptional({ description: 'Existing variant id (updates)' }) @IsOptional() @IsInt() id?: number;
  @ApiPropertyOptional({ description: 'Generated from style code, colour and size if omitted' })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,79}$/, { message: 'SKU may use letters, numbers and dashes' }) sku?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(60) color?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Use a hex colour like #D9A0A7' }) colorHex?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(30) size?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(MONEY, { message: MONEY_MSG }) price?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(MONEY, { message: MONEY_MSG }) compareAtPrice?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(MONEY, { message: MONEY_MSG }) costPrice?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(64) barcode?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [StockInput], description: 'Opening stock, only for new variants' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StockInput) stock?: StockInput[];
}

export class ImageInput {
  @ApiProperty() @IsUrl({ require_tld: false, protocols: ['http', 'https'] }, { message: 'Image must be an http(s) URL' }) @MaxLength(512) url: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(60) color?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(255) alt?: string;
}

export class AttributeInput {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(255) value: string;
}

export class ProductInput {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2, { message: 'Enter a product name' }) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Slug may use lowercase letters, numbers and dashes' }) @MaxLength(220) slug?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,63}$/, { message: 'Style code may use letters, numbers and dashes' }) styleCode?: string;
  @ApiProperty() @IsInt({ message: 'Choose a category' }) categoryId: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() brandId?: number | null;
  @ApiPropertyOptional({ description: 'null for VÉLORA-owned stock' }) @IsOptional() @IsInt() vendorId?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(500) shortDescription?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(20000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(255) material?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(500) careInstructions?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsUrl({ protocols: ['https'] }, { message: 'Video must be an https URL' }) videoUrl?: string;
  @ApiProperty() @Transform(trim) @Matches(MONEY, { message: MONEY_MSG }) basePrice: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(MONEY, { message: MONEY_MSG }) compareAtPrice?: string;
  @ApiPropertyOptional({ enum: ProductStatus }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFeatured?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @ApiPropertyOptional({ type: [AttributeInput] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AttributeInput) attributes?: AttributeInput[];
  @ApiPropertyOptional({ type: [ImageInput] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ImageInput) images?: ImageInput[];
  @ApiPropertyOptional({ type: [VariantInput], description: 'Full list: existing variants missing from it are deactivated' })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => VariantInput) variants?: VariantInput[];
}

export class AdminProductQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ProductStatus }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() categoryId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() brandId?: number;
  @ApiPropertyOptional({ description: '"platform" or a vendor id' }) @IsOptional() @IsString() owner?: string;
  @ApiPropertyOptional({ enum: ['low', 'out'] }) @IsOptional() @IsIn(['low', 'out']) stock?: 'low' | 'out';
  @ApiPropertyOptional({ enum: ['updated', 'name', 'price', 'stock', 'sold'] }) @IsOptional() @IsIn(['updated', 'name', 'price', 'stock', 'sold']) sort: 'updated' | 'name' | 'price' | 'stock' | 'sold' = 'updated';
}

export class RejectDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(5, { message: 'Tell the vendor what to fix' }) @MaxLength(500) reason: string;
}

export class ImportDto {
  @ApiProperty({ description: 'CSV text in the export format' }) @IsString() @MaxLength(5_000_000) csv: string;
  @ApiPropertyOptional({ description: 'Validate only; write nothing' }) @IsOptional() @IsBoolean() dryRun?: boolean;
}
