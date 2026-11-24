'use client';

import { Button, ButtonLink, Container } from '@/components/ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="py-24 text-center">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Something went wrong</h1>
      <p className="mx-auto mt-4 max-w-md text-muted">
        {error.message.includes('unavailable') ? error.message : 'We couldn’t load this page. Please try again in a moment.'}
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="secondary">Go home</ButtonLink>
      </div>
    </Container>
  );
}
