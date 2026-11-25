import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useCart } from '@/shop';
import { colors } from '@/theme';

export default function TabsLayout() {
  const cart = useCart();
  const count = cart.data?.itemCount ?? 0;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: string; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={23} color={color} />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.line },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="shop" options={{ title: 'Shop', tabBarIcon: icon('search') }} />
      <Tabs.Screen name="wishlist" options={{ title: 'Wishlist', tabBarIcon: icon('heart') }} />
      <Tabs.Screen name="bag" options={{ title: 'Bag', tabBarIcon: icon('bag'), tabBarBadge: count ? (count > 99 ? '99+' : count) : undefined, tabBarBadgeStyle: { backgroundColor: colors.rose, color: colors.ink, fontWeight: '700' } }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person') }} />
    </Tabs>
  );
}
