import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text } from 'react-native';
import { api } from '@/api';
import { ProductList } from '@/listing';
import { colors, space } from '@/theme';

interface Category { name: string; slug: string; children: Array<{ name: string; slug: string }>; siblings: Array<{ name: string; slug: string }> }

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const c = useQuery({ queryKey: ['category', slug], queryFn: () => api<Category>(`/categories/${slug}`, { auth: false }) });
  const sub = c.data ? (c.data.children.length ? c.data.children : c.data.siblings) : [];
  return (
    <>
      <Stack.Screen options={{ title: c.data?.name ?? '' }} />
      <ProductList params={{ category: slug }} header={sub.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2), marginBottom: space(3) }}>
          {sub.map((s) => {
            const active = s.slug === slug;
            return (
              <Pressable key={s.slug} onPress={() => !active && router.replace(`/c/${s.slug}`)} style={{ paddingHorizontal: space(3), paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: active ? colors.ink : colors.line, backgroundColor: active ? colors.ink : colors.paper }}>
                <Text style={{ fontSize: 13, color: active ? colors.paper : colors.ink }}>{s.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )} />
    </>
  );
}
