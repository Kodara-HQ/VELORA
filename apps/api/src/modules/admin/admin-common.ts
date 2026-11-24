import { BadRequestException, StreamableFile } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional } from 'class-validator';
import type { Response } from 'express';

export class DateRangeQuery {
  @ApiPropertyOptional({ description: 'ISO date (inclusive). Default: 30 days ago' }) @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (inclusive). Default: today' }) @IsOptional() @IsDateString()
  to?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  categoryId?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  productId?: number;

  @ApiPropertyOptional({ enum: ['web', 'mobile'] }) @IsOptional() @IsIn(['web', 'mobile'])
  channel?: 'web' | 'mobile';
}

/** Resolves [from, to) as full days, defaulting to the last 30 days; caps ranges at 2 years. */
export function resolveRange(q: { from?: string; to?: string }) {
  const to = q.to ? new Date(q.to) : new Date();
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1));
  const start = q.from ? new Date(q.from) : new Date(end.getTime() - 30 * 86_400_000);
  const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  if (from >= end) throw new BadRequestException('"from" must be before "to"');
  if (end.getTime() - from.getTime() > 731 * 86_400_000) throw new BadRequestException('Choose a range of two years or less');
  return { from, to: end, days: Math.round((end.getTime() - from.getTime()) / 86_400_000) };
}

/** Writes rows as RFC 4180 CSV with formula-injection protection for spreadsheet apps. */
export function sendCsv(res: Response, filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>): StreamableFile {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; // neutralise =CMD() etc.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  return new StreamableFile(Buffer.from(`﻿${body}`, 'utf8'));
}

/** Parses RFC 4180 CSV (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
