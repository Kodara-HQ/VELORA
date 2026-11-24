import { Container, Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <Container className="py-6 sm:py-8">
      <Skeleton className="mb-5 h-3 w-56" />
      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <Skeleton className="aspect-[3/4]" />
        <div className="space-y-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-24" />
          <Skeleton className="h-14" />
        </div>
      </div>
    </Container>
  );
}
