import { useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { api, ApiError, errorMessage, type SessionPayload } from '@/api';
import { useSession } from '@/session';
import { colors, space, type } from '@/theme';
import { Button, Field, Notice, Screen } from '@/ui';

export default function LoginScreen() {
  const qc = useQueryClient();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setLoading(true);
    try {
      await signIn(await api<SessionPayload>('/auth/login', { method: 'POST', auth: false, body: { email: email.trim(), password } }));
      // The guest bag is merged into the account by the API; refetch everything for the signed-in user.
      await qc.invalidateQueries();
      if (router.canGoBack()) router.back(); else router.replace('/(tabs)/account');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={[]}>
        <Text style={type.eyebrow}>Welcome back</Text>
        <Text style={[type.display, { marginTop: 4, marginBottom: space(6) }]}>Sign in</Text>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} returnKeyType="go" />
        <Button title="Sign in" onPress={submit} loading={loading} />
        <View style={{ marginTop: space(6), alignItems: 'center', gap: 10 }}>
          <Text style={type.small}>New to VÉLORA? <Link href="/register" replace style={{ color: colors.ink, fontWeight: '700', textDecorationLine: 'underline' }}>Create an account</Link></Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
