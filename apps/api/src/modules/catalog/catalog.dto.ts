import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.dto';

const toBool = ({ value }: { value: unknown }) => (value === undefined ? undefined : value === true || value === 'true' || value === '1');
const toList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : value;

export const SORTS = ['recommended', 'newest', 'popular', 'price_asc', 'price_desc', 'rating'] as const;
export type Sort = (typeof SORTS)[number];

export class ProductQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'Category slug; includes all sub-categories' })
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(140)
  category?: string;

  @ApiPropertyOptional({ description: 'Comma-separated brand slugs' })
  @IsOptional() @Transform(toList) @IsString({ each: true })
  brand?: string[];

  @ApiPropertyOptional({ description: 'Vendor shop slug' })
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(160)
  vendor?: string;

  @ApiPropertyOptional({ description: 'Comma-separated colour names' })
  @IsOptional() @Transform(toList) @IsString({ each: true })
  color?: string[];

  @ApiPropertyOptional({ description: 'Comma-separated sizes' })
  @IsOptional() @Transform(toList) @IsString({ each: true })
  size?: string[];

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  minPrice?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean()
  onSale?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: SORTS, default: 'recommended' }) @IsOptional() @IsIn(SORTS)
  sort: Sort = 'recommended';

  @ApiPropertyOptional({ default: 24 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60)
  override pageSize = 24;
}

export class FacetQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(160)
  vendor?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(140)
  category?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  q?: string;
}

export class SuggestQuery {
  @ApiPropertyOptional() @IsString() @MaxLength(100)
  q: string;
}

export class ReviewQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating?: number;

  @ApiPropertyOptional({ default: 10 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  override pageSize = 10;
}
