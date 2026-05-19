import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Circle, supabase } from '../src/lib/supabase';
import { colors, radius, spacing } from '../src/theme';

type CircleRow = Circle & {
  circle_members?: { joined_at: string }[];
};

type ModalMode = 'choice' | 'create' | 'join' | null;

type Profile = {
  default_username: string | null;
  avatar_base64: string | null;
  avatar_mime_type: string | null;
};

export default function CirclesScreen() {
  const [circles, setCircles] = useState<CircleRow[]>([]);
  const [circleName, setCircleName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [userEmail, setUserEmail] = useState('');

  const loadCircles = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace('/auth');
      return;
    }

    const { data, error } = await supabase
      .from('circles')
      .select('*, circle_members!inner(joined_at)')
      .eq('circle_members.user_id', userData.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      Alert.alert('Could not load circles', error.message);
      return;
    }

    setCircles(data ?? []);
  }, []);

  const loadProfile = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace('/auth');
      return;
    }

    setUserEmail(userData.user.email ?? '');

    const { data, error } = await supabase
      .from('profiles')
      .select('default_username,avatar_base64,avatar_mime_type')
      .eq('id', userData.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      Alert.alert('Could not load profile', error.message);
      return;
    }

    const profile = data as Profile | null;
    setProfileName(profile?.default_username ?? '');
    setAvatarBase64(profile?.avatar_base64 ?? null);
    setAvatarMimeType(profile?.avatar_mime_type ?? null);
  }, []);

  useEffect(() => {
    loadCircles();
    loadProfile();
  }, [loadCircles, loadProfile]);

  function closeModal() {
    setModalMode(null);
    setCircleName('');
    setInviteCode('');
  }

  async function createCircle() {
    if (!circleName.trim()) {
      Alert.alert('Name your circle first');
      return;
    }

    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      router.replace('/auth');
      return;
    }

    const { data: circleData, error: circleError } = await supabase
      .rpc('create_memory_circle', { circle_name: circleName.trim() })
      .single();

    if (circleError) {
      setLoading(false);
      Alert.alert('Could not create circle', circleError.message);
      return;
    }

    setLoading(false);

    const circle = circleData as Circle;
    closeModal();
    await loadCircles();
    router.push(`/circle/${circle.id}`);
  }

  async function joinCircle() {
    if (!inviteCode.trim()) {
      Alert.alert('Enter an invite code');
      return;
    }

    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data: requestData, error: circleError } = await supabase
      .rpc('request_join_memory_circle', { invite_code_input: inviteCode.trim().toUpperCase() })
      .single();

    if (!userData.user || circleError || !requestData) {
      setLoading(false);
      Alert.alert('Invite not found', circleError?.message ?? 'Try another code.');
      return;
    }

    const joinRequest = requestData as { circle_id: string; circle_name: string; status: string };
    setLoading(false);
    closeModal();

    if (joinRequest.status === 'already_member') {
      await loadCircles();
      router.push(`/circle/${joinRequest.circle_id}`);
      return;
    }

    Alert.alert('Request sent', `An admin of ${joinRequest.circle_name} can now approve your request.`);
  }

  async function pickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo permission needed', 'Allow photo access to choose a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      base64: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.35,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setAvatarBase64(asset.base64 ?? null);
    setAvatarMimeType(asset.mimeType ?? 'image/jpeg');
  }

  async function saveProfile() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { error } = await supabase.from('profiles').upsert({
      id: userData.user.id,
      default_username: profileName.trim() || null,
      avatar_base64: avatarBase64,
      avatar_mime_type: avatarMimeType,
    });

    if (error) {
      Alert.alert('Could not save profile', error.message);
      return;
    }

    setProfileOpen(false);
  }

  async function deleteAccount() {
    if (deleteConfirm !== 'DELETE') {
      Alert.alert('Confirmation required', 'Type DELETE to confirm account deletion.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.rpc('delete_current_user');
    setLoading(false);

    if (error) {
      Alert.alert('Could not delete account', error.message);
      return;
    }

    await supabase.auth.signOut();
    setDeleteOpen(false);
    setProfileOpen(false);
    router.replace('/auth');
  }

  async function logOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Could not log out', error.message);
      return;
    }

    setProfileOpen(false);
    router.replace('/auth');
  }

  return (
    <View style={styles.screen}>
      <Pressable onPress={() => setProfileOpen(true)} style={styles.profileButton}>
        {avatarBase64 ? (
          <Image source={{ uri: `data:${avatarMimeType ?? 'image/jpeg'};base64,${avatarBase64}` }} style={styles.profileImage} />
        ) : (
          <Text style={styles.profileIcon}>{profileName.slice(0, 1).toUpperCase() || 'P'}</Text>
        )}
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>My Circles</Text>
        <Text style={styles.subtitle}>Your memory circles</Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        <Pressable onPress={() => setModalMode('choice')} style={[styles.tile, styles.addTile]}>
          <Text style={styles.plus}>+</Text>
          <Text style={styles.addTitle}>New Circle</Text>
          <Text style={styles.addMeta}>Create or join</Text>
        </Pressable>

        {circles.map((circle) => (
          <Pressable key={circle.id} onPress={() => router.push(`/circle/${circle.id}`)} style={styles.tile}>
            {circle.avatar_base64 ? (
              <Image source={{ uri: `data:${circle.avatar_mime_type ?? 'image/jpeg'};base64,${circle.avatar_base64}` }} style={styles.circleAvatar} />
            ) : (
              <View style={styles.photoStack}>
                <View style={[styles.photo, styles.photoBack]} />
                <View style={[styles.photo, styles.photoFront]}>
                  <Text style={styles.photoLetter}>{circle.name.slice(0, 1).toUpperCase()}</Text>
                </View>
              </View>
            )}
            <Text numberOfLines={2} style={styles.circleName}>{circle.name}</Text>
            <Text style={styles.meta}>Invite {circle.invite_code}</Text>
          </Pressable>
        ))}

        {circles.length === 0 && (
          <Text style={styles.emptyText}>Create your first memory circle or join one with an invite code.</Text>
        )}
      </ScrollView>

      <Modal animationType="fade" transparent visible={modalMode !== null} onRequestClose={closeModal}>
        <View style={styles.modalShade}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {modalMode === 'choice'
                  ? 'New memory circle'
                  : modalMode === 'create'
                    ? 'Create a memory circle'
                    : 'Join a memory circle'}
              </Text>
              <Pressable onPress={closeModal}>
                <Text style={styles.closeButton}>x</Text>
              </Pressable>
            </View>

            {modalMode === 'choice' && (
              <View style={styles.modalBody}>
                <Text style={styles.prompt}>Do you want to join an existing group, or create a new one?</Text>
                <Pressable onPress={() => setModalMode('create')} style={styles.roseButton}>
                  <Text style={styles.buttonText}>Create a New Group</Text>
                </Pressable>
                <Pressable onPress={() => setModalMode('join')} style={styles.lilacButton}>
                  <Text style={styles.darkButtonText}>Join Existing Group</Text>
                </Pressable>
              </View>
            )}

            {modalMode === 'create' && (
              <View style={styles.modalBody}>
                <TextInput
                  onChangeText={setCircleName}
                  placeholder="Group name"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={circleName}
                />
                <Pressable disabled={loading} onPress={createCircle} style={styles.roseButton}>
                  <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Circle'}</Text>
                </Pressable>
              </View>
            )}

            {modalMode === 'join' && (
              <View style={styles.modalBody}>
                <TextInput
                  autoCapitalize="characters"
                  maxLength={6}
                  onChangeText={setInviteCode}
                  placeholder="Invite code"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={inviteCode}
                />
                <Pressable disabled={loading} onPress={joinCircle} style={styles.lilacButton}>
                  <Text style={styles.darkButtonText}>{loading ? 'Joining...' : 'Join Circle'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={profileOpen} onRequestClose={() => setProfileOpen(false)}>
        <View style={styles.modalShade}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>My profile</Text>
              <Pressable onPress={() => setProfileOpen(false)}>
                <Text style={styles.closeButton}>x</Text>
              </Pressable>
            </View>

            <View style={styles.profilePreview}>
              {avatarBase64 ? (
                <Image source={{ uri: `data:${avatarMimeType ?? 'image/jpeg'};base64,${avatarBase64}` }} style={styles.largeProfileImage} />
              ) : (
                <View style={styles.largeProfileFallback}>
                  <Text style={styles.largeProfileInitial}>{profileName.slice(0, 1).toUpperCase() || 'P'}</Text>
                </View>
              )}
              <Pressable onPress={pickAvatar} style={styles.lilacButton}>
                <Text style={styles.darkButtonText}>Choose Profile Photo</Text>
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              <TextInput
                onChangeText={setProfileName}
                placeholder="Default username"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={profileName}
              />
              <Pressable disabled={loading} onPress={saveProfile} style={styles.roseButton}>
                <Text style={styles.buttonText}>Save Profile</Text>
              </Pressable>
              <Pressable onPress={logOut} style={styles.logoutButton}>
                <Text style={styles.logoutButtonText}>Log Out</Text>
              </Pressable>
              <Pressable onPress={() => setDeleteOpen(true)} style={styles.deleteButton}>
                <Text style={styles.deleteButtonText}>Delete Account</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={deleteOpen} onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.modalShade}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delete account?</Text>
              <Pressable onPress={() => setDeleteOpen(false)}>
                <Text style={styles.closeButton}>x</Text>
              </Pressable>
            </View>
            <Text style={styles.warningText}>
              This permanently deletes your account, profile, memberships, memories, likes, and comments. This cannot be undone.
            </Text>
            {!!userEmail && <Text style={styles.meta}>Signed in as {userEmail}</Text>}
            <TextInput
              autoCapitalize="characters"
              onChangeText={setDeleteConfirm}
              placeholder="Type DELETE"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={deleteConfirm}
            />
            <Pressable disabled={loading} onPress={deleteAccount} style={styles.dangerButton}>
              <Text style={styles.buttonText}>{loading ? 'Deleting...' : 'Permanently Delete Account'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: spacing.lg,
    paddingTop: 64,
  },
  profileButton: {
    position: 'absolute',
    right: spacing.lg,
    top: 58,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    zIndex: 2,
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  profileIcon: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  header: {
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.rose,
    fontSize: 15,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  tile: {
    width: '47.7%',
    minHeight: 188,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  addTile: {
    borderStyle: 'dashed',
    borderColor: colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#fff1f3',
  },
  plus: {
    color: colors.ink,
    fontSize: 44,
    lineHeight: 48,
  },
  addTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  addMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  photoStack: {
    height: 76,
  },
  photo: {
    position: 'absolute',
    width: 70,
    height: 78,
    borderRadius: radius.sm,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBack: {
    left: 16,
    top: 0,
    backgroundColor: colors.lilac,
    transform: [{ rotate: '5deg' }],
  },
  photoFront: {
    left: 0,
    top: 8,
    backgroundColor: colors.roseSoft,
    transform: [{ rotate: '-4deg' }],
  },
  photoLetter: {
    color: colors.white,
    fontSize: 30,
    fontWeight: '700',
  },
  circleAvatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignSelf: 'center',
  },
  circleName: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
  },
  emptyText: {
    width: '100%',
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  modalShade: {
    flex: 1,
    backgroundColor: 'rgba(47, 41, 38, 0.28)',
    justifyContent: 'flex-end',
  },
  modalCard: {
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
  modalBody: {
    gap: spacing.md,
  },
  profilePreview: {
    alignItems: 'center',
    gap: spacing.md,
  },
  largeProfileImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  largeProfileFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.roseSoft,
  },
  largeProfileInitial: {
    color: colors.white,
    fontSize: 38,
    fontWeight: '700',
  },
  prompt: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22,
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  roseButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  lilacButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lilac,
    paddingHorizontal: spacing.md,
  },
  deleteButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.rose,
  },
  logoutButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  logoutButtonText: {
    color: colors.ink,
    fontWeight: '700',
  },
  deleteButtonText: {
    color: colors.rose,
    fontWeight: '700',
  },
  dangerButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#bd2f45',
  },
  warningText: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  buttonText: {
    color: colors.white,
    fontWeight: '700',
  },
  darkButtonText: {
    color: colors.ink,
    fontWeight: '700',
  },
});
