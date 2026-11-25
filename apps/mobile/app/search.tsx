import { Stack, useLocalSearchParams } from 'expo-router';
import { ProductList } from '@/listing';

export default function SearchScreen() {
  const p = useLocalSearchParams<{ q?: string; sort?: string; onSale?: string }>();
  const title = p.q ? `“${p.q}”` : p.onSale === 'true' ? 'Sale' : p.sort === 'newest' ? 'New in' : p.sort === 'popular' ? 'Best sellers' : 'Shop';
  return (
    <>
      <Stack.Screen options={{ title }} />
      <ProductList params={{ q: p.q, sort: p.sort, onSale: p.onSale }}
        emptyTitle={p.q ? `Nothing found for “${p.q}”` : 'No pieces here yet'} emptyBody={p.q ? 'Check the spelling or try a broader word like “dress” or “bag”.' : undefined} />
    </>
  );
}
