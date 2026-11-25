import { Stack, useLocalSearchParams } from 'expo-router';
import { OrderView } from '@/order-view';

export default function AccountOrderScreen() {
  const { number } = useLocalSearchParams<{ number: string }>();
  return (
    <>
      <Stack.Screen options={{ title: number }} />
      <OrderView number={number} />
    </>
  );
}
