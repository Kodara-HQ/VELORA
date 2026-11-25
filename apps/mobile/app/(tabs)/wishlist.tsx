import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Text, useWindowDimensions } from 'react-native';
import { api, errorMessage } from '@/api';
import { useSession } from '@/session';
import { space, type } from '@/theme';
import type { ProductCard as Card } from '@/types';
import { Button, Empty, Loading, Notice, ProductGrid, Screen } from '@/ui';

export default function WishlistScreen() {
  const { width } = useWindowDimensions();
  const status = useSession((s) => s.status);
  const q = useQuery({ queryKey: ['wishlist'], queryFn: () => api<Array<{ addedAt: string; product: Card }>>('/me/wishlist'), enabled: status === 'authenticated' });

  if (status !== 'authenticated') {
    return <Screen><Empty title="Save what you love" body="Sign in to keep a wishlist across your phone and the website." action={<Button title="Sign in" onPress={() => router.push('/login')} />} /></Screen>;
  }
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Text style={[type.display, { marginBottom: space(4) }]}>Wishlist</Text>
      {q.isPending ? <Loading /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : !q.data.length ? (
        <Empty title="Nothing saved yet" body="Tap the heart on any piece to save it here." action={<Button title="Start shopping" variant="secondary" onPress={() => router.push('/(tabs)/shop')} />} />
      ) : <ProductGrid products={q.data.map((i) => i.product)} width={width} />}
    </Screen>
  );
}
