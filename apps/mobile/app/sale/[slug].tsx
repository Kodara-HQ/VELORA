import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { api } from '@/api';
import { ProductList } from '@/listing';
import { colors, space, type } from '@/theme';
import { Countdown, Empty, Loading } from '@/ui';

interface Sale { name: string; slug: string; type: string; headline: string | null; startsAt: string; endsAt: string; state: string }

export default function SaleScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const s = useQuery({ queryKey: ['sale', slug], queryFn: () => api<Sale>(`/promotions/${slug}`, { auth: false }) });
  if (s.isPending) return <Loading />;
  if (!s.data) return <Empty title="This sale isn’t available" />;
  const sale = s.data;
  return (
    <>
      <Stack.Screen options={{ title: sale.name }} />
      {sale.state !== 'LIVE' ? (
        <Empty title={sale.state === 'SCHEDULED' ? 'Coming soon' : 'This sale has ended'} body={sale.headline ?? undefined}
          action={sale.state === 'SCHEDULED' ? <Text style={type.h2}>Starts in <Countdown to={sale.startsAt} onDone={() => void s.refetch()} /></Text> : undefined} />
      ) : (
        <ProductList params={{ promotion: slug }} header={
          <View style={{ backgroundColor: colors.ink, padding: space(4), marginBottom: space(3) }}>
            <Text style={[type.eyebrow, { color: colors.rose }]}>Ends in</Text>
            <Countdown to={sale.endsAt} onDone={() => void s.refetch()} style={{ fontSize: 30, fontWeight: '800', color: colors.paper }} />
            {sale.headline && <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 4 }}>{sale.headline}</Text>}
          </View>
        } />
      )}
    </>
  );
}
