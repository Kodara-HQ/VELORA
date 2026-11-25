import { Stack, useLocalSearchParams } from 'expo-router';
import { OrderView } from '@/order-view';

export default function PlacedOrderScreen() {
  const { number, payError } = useLocalSearchParams<{ number: string; payError?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Your order', headerBackVisible: false, gestureEnabled: false }} />
      <OrderView number={number} justPlaced payError={payError === '1'} />
    </>
  );
}
