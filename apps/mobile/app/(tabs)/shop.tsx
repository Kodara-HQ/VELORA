import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api';
import { money } from '@/format';
import { colors, space, type } from '@/theme';
import type { CategoryNode } from '@/types';
import { ListItem, styles } from '@/ui';

interface Suggestions { didYouMean?: string | null; products: Array<{ slug: string; name: string; price: string }>; categories: Array<{ name: string; slug: string; parent: string | null }>; brands: Array<{ name: string; slug: string }> }

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function ShopScreen() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebounced(term.trim());
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<CategoryNode[]>('/categories', { auth: false }), staleTime: 600_000 });
  const trending = useQuery({ queryKey: ['trending'], queryFn: () => api<string[]>('/search/trending', { auth: false }) });
  const suggest = useQuery({ queryKey: ['suggest', q], queryFn: () => api<Suggestions>(`/search/suggest?q=${encodeURIComponent(q)}`, { auth: false }), enabled: q.length >= 2 });
  const search = (s: string) => { if (s.trim()) router.push(`/search?q=${encodeURIComponent(s.trim())}`); };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={{ padding: space(4), paddingBottom: space(2) }}>
        <View style={[styles.row, { height: 46, borderRadius: 23, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingHorizontal: space(4), gap: 8 }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={term} onChangeText={setTerm} placeholder="Search VÉLORA" placeholderTextColor={colors.muted} returnKeyType="search" onSubmitEditing={() => search(term)}
            style={{ flex: 1, fontSize: 16, color: colors.ink }} accessibilityLabel="Search VÉLORA" autoCorrect={false} />
          {!!term && <Pressable onPress={() => setTerm('')} hitSlop={8} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space(10) }}>
        {q.length >= 2 ? (
          <View>
            {suggest.data?.didYouMean && <ListItem icon="sparkles-outline" title={`Did you mean “${suggest.data.didYouMean}”?`} onPress={() => search(suggest.data!.didYouMean!)} />}
            <ListItem icon="search" title={`Search for “${q}”`} onPress={() => search(q)} />
            {suggest.data?.categories.map((c) => <ListItem key={c.slug} icon="grid-outline" title={c.name} subtitle={c.parent ? `in ${c.parent}` : 'Department'} onPress={() => router.push(`/c/${c.slug}`)} />)}
            {suggest.data?.brands.map((b) => <ListItem key={b.slug} icon="pricetag-outline" title={b.name} subtitle="Brand" onPress={() => search(b.name)} />)}
            {suggest.data?.products.map((p) => <ListItem key={p.slug} icon="shirt-outline" title={p.name} subtitle={money(p.price)} onPress={() => router.push(`/p/${p.slug}`)} />)}
          </View>
        ) : (
          <View>
            {!!trending.data?.length && (
              <View style={{ paddingHorizontal: space(4), marginBottom: space(5) }}>
                <Text style={[type.eyebrow, { marginBottom: space(2) }]}>Trending</Text>
                <View style={[styles.row, { flexWrap: 'wrap', gap: space(2) }]}>
                  {trending.data.map((t) => (
                    <Pressable key={t} onPress={() => search(t)} style={{ paddingHorizontal: space(3), paddingVertical: 7, borderRadius: 16, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line }}>
                      <Text style={{ fontSize: 13 }}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            <Text style={[type.eyebrow, { paddingHorizontal: space(4), marginBottom: space(2) }]}>Departments</Text>
            <ListItem icon="sparkles-outline" title="New in" onPress={() => router.push('/search?sort=newest')} />
            <ListItem icon="flame-outline" title="Sale" onPress={() => router.push('/search?onSale=true')} />
            {(cats.data ?? []).map((c) => (
              <View key={c.slug}>
                <ListItem title={c.name} onPress={() => setOpen(open === c.slug ? null : c.slug)}
                  right={<Ionicons name={open === c.slug ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />} />
                {open === c.slug && (
                  <View style={{ backgroundColor: colors.ivory }}>
                    <ListItem title={`Shop all ${c.name}`} onPress={() => router.push(`/c/${c.slug}`)} />
                    {c.children.map((ch) => <ListItem key={ch.slug} title={`   ${ch.name}`} onPress={() => router.push(`/c/${ch.slug}`)} />)}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
