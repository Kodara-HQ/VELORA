import { ProductGridSkeleton } from '@/components/product-card';
import { Container, Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <Container className="py-8 sm:py-10">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-4 h-10 w-64" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <div className="hidden space-y-4 lg:block">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <ProductGridSkeleton />
      </div>
    </Container>
  );
}
