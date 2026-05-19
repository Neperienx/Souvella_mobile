import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '../src/lib/supabase';
import { colors, radius, spacing } from '../src/theme';

type AuthMode = 'signIn' | 'signUp';
type LegalModal = 'terms' | 'privacy' | null;

const LEGAL_VERSION = '2026-05-19-draft';

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [legalModal, setLegalModal] = useState<LegalModal>(null);
  const [loading, setLoading] = useState(false);

  async function authenticate() {
    if (!email.trim() || !password) {
      Alert.alert('Add your email and password first');
      return;
    }

    if (mode === 'signUp' && (!acceptedTerms || !acceptedPrivacy)) {
      Alert.alert('Consent required', 'Please accept the Terms and Privacy Policy to create an account.');
      return;
    }

    setLoading(true);
    const acceptedAt = new Date().toISOString();
    const credentials = { email: email.trim(), password };
    const result =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp({
            ...credentials,
            options: {
              data: {
                terms_accepted_at: acceptedAt,
                privacy_accepted_at: acceptedAt,
                legal_version: LEGAL_VERSION,
              },
            },
          });

    setLoading(false);

    if (result.error) {
      Alert.alert(mode === 'signIn' ? 'Could not log in' : 'Could not create account', result.error.message);
      return;
    }

    if (mode === 'signUp' && result.data.user && result.data.session) {
      await supabase.from('profiles').upsert({
        id: result.data.user.id,
        terms_accepted_at: acceptedAt,
        privacy_accepted_at: acceptedAt,
        legal_version: LEGAL_VERSION,
      });
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
        {mode === 'signUp' && (
          <View style={styles.legalBox}>
            <ConsentRow
              checked={acceptedTerms}
              label="I accept the Terms and Conditions"
              onPress={() => setAcceptedTerms((value) => !value)}
              onOpen={() => setLegalModal('terms')}
            />
            <ConsentRow
              checked={acceptedPrivacy}
              label="I accept the Privacy Policy"
              onPress={() => setAcceptedPrivacy((value) => !value)}
              onOpen={() => setLegalModal('privacy')}
            />
          </View>
        )}
        <Pressable disabled={loading} onPress={authenticate} style={styles.primaryButton}>
          <Text style={styles.primaryText}>
            {loading ? 'One moment...' : mode === 'signIn' ? 'Log In' : 'Create Account'}
          </Text>
        </Pressable>
      </View>

      <Modal animationType="fade" transparent visible={legalModal !== null} onRequestClose={() => setLegalModal(null)}>
        <View style={styles.modalShade}>
          <View style={styles.legalModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{legalModal === 'terms' ? 'Terms and Conditions' : 'Privacy Policy'}</Text>
              <Pressable onPress={() => setLegalModal(null)}>
                <Text style={styles.closeButton}>x</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.legalContent}>
              {(legalModal === 'terms' ? termsText : privacyText).map((paragraph) => (
                <Text key={paragraph} style={styles.legalParagraph}>{paragraph}</Text>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function ConsentRow(props: { checked: boolean; label: string; onPress: () => void; onOpen: () => void }) {
  return (
    <View style={styles.consentRow}>
      <Pressable onPress={props.onPress} style={[styles.checkbox, props.checked && styles.checkedBox]}>
        <Text style={styles.checkText}>{props.checked ? 'x' : ''}</Text>
      </Pressable>
      <Pressable onPress={props.onOpen} style={styles.consentLabelWrap}>
        <Text style={styles.consentLabel}>{props.label}</Text>
        <Text style={styles.readLink}>Read</Text>
      </Pressable>
    </View>
  );
}

const termsText = [
  'Souvella lets you create private memory circles and share text, photo, and voice memories with circle members.',
  'You are responsible for the content you upload and must only share memories you have the right to share.',
  'Do not upload illegal, abusive, hateful, privacy-invasive, exploitative, or harmful content.',
  'Circle invite codes should only be shared with trusted people. Members of a circle can see memories shared in that circle.',
  'You may delete your account from the app. The final production deletion and moderation behavior must be reviewed before store release.',
  'This draft is provided for product testing and must be replaced or reviewed before public launch.',
];

const privacyText = [
  'Souvella collects account data, profile data, circle memberships, memories, likes, comments, and technical data needed to provide and secure the service.',
  'Your memories are shown only to members of the relevant circle, subject to the app permissions and database security rules.',
  'The app stores synced memories, media payloads, likes, comments, and nicknames locally on your device so you can view them offline.',
  'Under GDPR, processing may rely on contract necessity, consent, legitimate interests, or legal obligations depending on the feature.',
  'You can request access, correction, deletion, restriction, portability, or objection where applicable. Production text must include real controller/contact details.',
  'This draft is GDPR-aware but is not legal advice and should be reviewed before public launch.',
];

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
  legalBox: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  checkedBox: {
    borderColor: colors.rose,
    backgroundColor: colors.roseSoft,
  },
  checkText: {
    color: colors.ink,
    fontWeight: '700',
  },
  consentLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  consentLabel: {
    flex: 1,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  readLink: {
    color: colors.rose,
    fontSize: 13,
    fontWeight: '700',
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
  modalShade: {
    flex: 1,
    backgroundColor: 'rgba(47, 41, 38, 0.28)',
    justifyContent: 'flex-end',
  },
  legalModal: {
    maxHeight: '82%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.paper,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  closeButton: {
    color: colors.muted,
    fontSize: 24,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
  },
  legalContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  legalParagraph: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
  },
});
