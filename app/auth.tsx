import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '../src/lib/supabase';
import { colors, radius, spacing } from '../src/theme';

type AuthMode = 'signIn' | 'signUp';

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function authenticate() {
    if (!email.trim() || !password) {
      Alert.alert('Add your email and password first');
      return;
    }

    setLoading(true);
    const credentials = { email: email.trim(), password };
    const result =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);

    setLoading(false);

    if (result.error) {
      Alert.alert(mode === 'signIn' ? 'Could not log in' : 'Could not create account', result.error.message);
      return;
    }

    router.replace('/circles');
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.title}>Souvella</Text>
        <Text style={styles.subtitle}>Where memories come to life</Text>
        <View style={styles.monogram}>
          <Text style={styles.monogramText}>S</Text>
        </View>
        <Text style={styles.caption}>{mode === 'signIn' ? 'Log in to open your scrapbook' : 'Create your scrapbook account'}</Text>
      </View>

      <View style={styles.modeSwitch}>
        <Pressable onPress={() => setMode('signIn')} style={[styles.modeButton, mode === 'signIn' && styles.activeMode]}>
          <Text style={[styles.modeText, mode === 'signIn' && styles.activeModeText]}>Log in</Text>
        </Pressable>
        <Pressable onPress={() => setMode('signUp')} style={[styles.modeButton, mode === 'signUp' && styles.activeMode]}>
          <Text style={[styles.modeText, mode === 'signUp' && styles.activeModeText]}>Register</Text>
        </Pressable>
      </View>

      <View style={styles.form}>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={email}
        />
        <TextInput
          autoCapitalize="none"
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <Pressable disabled={loading} onPress={authenticate} style={styles.primaryButton}>
          <Text style={styles.primaryText}>
            {loading ? 'One moment...' : mode === 'signIn' ? 'Log In' : 'Create Account'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.ink,
    fontSize: 42,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.rose,
    fontSize: 16,
    fontWeight: '700',
  },
  monogram: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.roseSoft,
  },
  monogramText: {
    color: colors.white,
    fontSize: 52,
    fontWeight: '300',
  },
  caption: {
    color: colors.ink,
    fontSize: 15,
  },
  modeSwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: 4,
    marginBottom: spacing.md,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeMode: {
    backgroundColor: colors.rose,
  },
  modeText: {
    color: colors.muted,
    fontWeight: '700',
  },
  activeModeText: {
    color: colors.white,
  },
  form: {
    gap: spacing.md,
  },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    color: colors.ink,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  primaryButton: {
    minHeight: 58,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  primaryText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
