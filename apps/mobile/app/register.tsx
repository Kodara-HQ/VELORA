import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, errorMessage, type SessionPayload } from '@/api';
import { useSession } from '@/session';
import { colors, space, type } from '@/theme';
import { Button, Field, Notice, Screen } from '@/ui';

export default function RegisterScreen() {
  const qc = useQueryClient();
  const signIn = useSession((s) => s.signIn);
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const [v, setV] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', referralCode: (ref ?? '').toUpperCase() });
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof v) => (t: string) => setV({ ...v, [k]: t });

  async function submit() {
    const phone = v.phone.replace(/[\s-]/g, '');
    const local: Record<string, string> = {};
    if (!v.firstName.trim()) local.firstName = 'First name is required';
    if (!v.lastName.trim()) local.lastName = 'Last name is required';
    if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) local.email = 'Enter a valid email address';
    if (phone && !/^\+233[2-5]\d{8}$/.test(phone)) local.phone = 'Use the format +233241234567';
    if (!/^(?=.*[A-Za-z])(?=.*\d).{10,128}$/.test(v.password)) local.password = 'At least 10 characters, with a letter and a number';
    setErrors(local);
    setError(null);
    if (Object.keys(local).length) return;
    setLoading(true);
    try {
      await signIn(await api<SessionPayload>('/auth/register', {
        method: 'POST', auth: false,
        body: { firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email.trim(), phone: phone || undefined, password: v.password, marketingOptIn: marketing, referralCode: v.referralCode.trim() || undefined },
      }));
      await qc.invalidateQueries();
      router.replace('/(tabs)/account');
    } catch (e) {
      if (e instanceof ApiError) { setErrors(e.fieldErrors); setError(e.message); } else setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={[]}>
        <Text style={type.eyebrow}>Join VÉLORA</Text>
        <Text style={[type.display, { marginTop: 4 }]}>Create your account</Text>
        <Text style={[type.small, { marginBottom: space(6) }]}>Earn points from your first order.</Text>
        {error && !Object.keys(errors).length && <Notice tone="danger">{error}</Notice>}
        <Field label="First name" value={v.firstName} onChangeText={set('firstName')} autoComplete="given-name" error={errors.firstName} />
        <Field label="Last name" value={v.lastName} onChangeText={set('lastName')} autoComplete="family-name" error={errors.lastName} />
        <Field label="Email" value={v.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errors.email} />
        <Field label="Mobile number (optional)" value={v.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+233 24 123 4567" error={errors.phone} hint="For delivery updates by SMS." />
        <Field label="Password" value={v.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" error={errors.password} hint="At least 10 characters, with a letter and a number." />
        <Field label="Referral code (optional)" value={v.referralCode} onChangeText={(t) => set('referralCode')(t.toUpperCase())} autoCapitalize="characters" error={errors.referralCode} />
        <Pressable onPress={() => setMarketing(!marketing)} accessibilityRole="checkbox" accessibilityState={{ checked: marketing }} style={{ flexDirection: 'row', gap: 10, marginBottom: space(5), alignItems: 'flex-start' }}>
          <Ionicons name={marketing ? 'checkbox' : 'square-outline'} size={22} color={colors.ink} />
          <Text style={[type.body, { flex: 1, fontSize: 14 }]}>Send me new arrivals, sales and member offers.</Text>
        </Pressable>
        <Button title="Create account" onPress={submit} loading={loading} />
        <View style={{ height: space(6) }} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
