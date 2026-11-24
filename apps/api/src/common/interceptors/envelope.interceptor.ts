import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Paginated } from '../dto/pagination.dto';

/** Wraps successful responses as `{ success: true, data, meta? }`. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result) => {
        if (result instanceof StreamableFile) return result; // file downloads (CSV, PDF) pass through untouched
        if (result instanceof Paginated) return { success: true, data: result.items, meta: result.meta };
        return { success: true, data: result ?? null };
      }),
    );
  }
}
