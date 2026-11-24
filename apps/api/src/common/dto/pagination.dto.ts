import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { PaginationMeta } from '@velora/shared';

export class PaginationQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional() @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';

  get skip() {
    return (this.page - 1) * this.pageSize;
  }
}

/** Return this from a controller to get `{ data: items, meta }` in the envelope. */
export class Paginated<T> {
  readonly meta: PaginationMeta;
  constructor(readonly items: T[], total: number, query: Pick<PaginationQuery, 'page' | 'pageSize'>) {
    this.meta = { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) };
  }
}
