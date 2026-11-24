import { ButtonLink, Container } from '@/components/ui';

export default function NotFound() {
  return (
    <Container className="py-24 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-deep">404</p>
      <h1 className="mt-4 text-4xl font-extrabold sm:text-5xl">This page has left the runway.</h1>
      <p className="mx-auto mt-4 max-w-md text-muted">The piece or page you’re looking for may have sold out or moved.</p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/shop?sort=newest">Shop new in</ButtonLink>
        <ButtonLink href="/" variant="secondary">Go home</ButtonLink>
      </div>
    </Container>
  );
}
