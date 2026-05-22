import { router, useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Circle, supabase } from '../../src/lib/supabase';
import { LikeState, MemoryInteraction, loadCircleInteractions } from '../../src/lib/interactions';
import {
  Memory,
  MemoryKind,
  encodeTextAsBase64,
  selectMemoryGems,
  selectTodayMemories,
  syncCircleMemories,
  todayKey,
} from '../../src/lib/memories';
import { colors, fonts, radius, spacing } from '../../src/theme';

const handwrittenFont = fonts.handwriting;

type CircleRole = 'owner' | 'admin' | 'member';

type CircleMember = {
  user_id: string;
  nickname: string | null;
  role: CircleRole;
  joined_at: string;
  default_username: string | null;
  avatar_base64: string | null;
  avatar_mime_type: string | null;
};

type JoinRequest = {
  id: string;
  requester_id: string;
  requester_name: string;
  avatar_base64: string | null;
  avatar_mime_type: string | null;
  created_at: string;
};

export default function CircleHomeScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const circleId = Array.isArray(idParam) ? idParam[0] : idParam;
  const [circle, setCircle] = useState<Circle | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<MemoryKind>('text');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string | null>(null);
  const [voiceBase64, setVoiceBase64] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [circleNameDraft, setCircleNameDraft] = useState('');
  const [circleAvatarBase64, setCircleAvatarBase64] = useState<string | null>(null);
  const [circleAvatarMimeType, setCircleAvatarMimeType] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<CircleRole>('member');
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [debugDayOffset, setDebugDayOffset] = useState(0);
  const [interactions, setInteractions] = useState<Record<string, MemoryInteraction>>({});
  const [likeState, setLikeState] = useState<LikeState>({ likesLimit: 0, likesUsed: 0 });
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Checking for memories...');
  const spin = useRef(new Animated.Value(0)).current;
  const interactionSyncReady = useRef(false);

  const currentDate = useMemo(() => todayKey(debugDayOffset), [debugDayOffset]);
  const todayMemories = useMemo(() => selectTodayMemories(memories, currentDate), [memories, currentDate]);
  const gems = useMemo(() => selectMemoryGems(memories, 5, currentDate), [memories, currentDate]);
  const hasUploadedToday = todayMemories.some((memory) => memory.author_id === currentUserId);
  const memberCount = Object.keys(memberNames).length;
  const canManageCircle = myRole === 'owner' || myRole === 'admin';

  const refreshMemories = useCallback(async () => {
    if (!circleId) return;

    setSyncing(true);
    const result = await syncCircleMemories(circleId);
    setMemories(result.memories);
    setSyncMessage(result.synced ? 'Up to date for offline reading' : 'Offline cache shown');
    setSyncing(false);
  }, [circleId]);

  const refreshInteractions = useCallback(async (userIdOverride?: string | null) => {
    if (!circleId) return;

    setSyncing(true);
    const result = await loadCircleInteractions(circleId, currentDate, userIdOverride ?? currentUserId);
    if (result.error) {
      setSyncMessage('Offline cache shown');
    }

    setInteractions(result.interactions);
    setLikeState(result.likeState);
    setMemberNames((current) => ({ ...current, ...result.memberNames }));
    setSyncing(false);
  }, [circleId, currentDate, currentUserId]);

  const refreshCircleProfile = useCallback(async (userIdOverride?: string | null) => {
    if (!circleId) return;

    const { data: membersData, error: membersError } = await supabase
      .rpc('get_circle_members', { circle_id_input: circleId });

    if (membersError) {
      Alert.alert('Could not load members', membersError.message);
      return;
    }

    const nextMembers = (membersData ?? []) as CircleMember[];
    setMembers(nextMembers);
    setMemberNames((current) => ({
      ...current,
      ...Object.fromEntries(
        nextMembers.map((member) => [
          member.user_id,
          member.nickname || member.default_username || 'Someone',
        ]),
      ),
    }));

    const effectiveUserId = userIdOverride ?? currentUserId;
    const me = nextMembers.find((member) => member.user_id === effectiveUserId);
    if (me) {
      setMyRole(me.role);
      setNickname(me.nickname ?? null);
      setNicknameDraft(me.nickname ?? '');
    }

    const canLoadRequests = me?.role === 'owner' || me?.role === 'admin';
    if (!canLoadRequests) {
      setJoinRequests([]);
      return;
    }

    const { data: requestsData, error: requestsError } = await supabase
      .rpc('get_circle_join_requests', { circle_id_input: circleId });

    if (requestsError) {
      Alert.alert('Could not load join requests', requestsError.message);
      return;
    }

    setJoinRequests((requestsData ?? []) as JoinRequest[]);
  }, [circleId, currentUserId]);

  useEffect(() => {
    if (!syncing) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => animation.stop();
  }, [spin, syncing]);

  useEffect(() => {
    async function loadCircle() {
      if (!circleId) {
        Alert.alert('Could not open circle', 'Missing circle id.');
        router.back();
        return;
      }

      const [{ data: userData }, circleResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('circles').select('*').eq('id', circleId).maybeSingle(),
      ]);

      setCurrentUserId(userData.user?.id ?? null);

      if (circleResult.error || !circleResult.data) {
        Alert.alert(
          'Could not open circle',
          circleResult.error?.message ?? 'This account is not currently a member of this circle.',
        );
        return;
      }

      setCircle(circleResult.data);
      setCircleNameDraft(circleResult.data.name);
      setCircleAvatarBase64(circleResult.data.avatar_base64 ?? null);
      setCircleAvatarMimeType(circleResult.data.avatar_mime_type ?? null);

      if (userData.user) {
        const { data: membership } = await supabase
          .from('circle_members')
          .select('nickname,role')
          .eq('circle_id', circleId)
          .eq('user_id', userData.user.id)
          .maybeSingle();

        setNickname(membership?.nickname ?? null);
        setNicknameDraft(membership?.nickname ?? '');
        setMyRole((membership?.role as CircleRole | undefined) ?? 'member');
      }

      await refreshMemories();
      await refreshInteractions(userData.user?.id ?? null);
      await refreshCircleProfile(userData.user?.id ?? null);
      interactionSyncReady.current = true;
    }

    loadCircle();
  }, [circleId, refreshCircleProfile, refreshInteractions, refreshMemories]);

  useEffect(() => {
    if (interactionSyncReady.current) {
      refreshInteractions();
    }
  }, [currentDate]);

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo permission needed', 'Allow photo access to share a photo memory.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [4, 3],
      base64: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.45,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setPhotoBase64(asset.base64 ?? null);
    setPhotoMimeType(asset.mimeType ?? 'image/jpeg');
  }

  async function toggleRecording() {
    if (recording) {
      const currentRecording = recording;
      setRecording(null);
      await currentRecording.stopAndUnloadAsync();
      const uri = currentRecording.getURI();
      if (!uri) return;

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setVoiceBase64(base64);
      return;
    }

    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone permission needed', 'Allow microphone access to share a voice note.');
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(created.recording);
  }

  async function uploadMemory() {
    const note = draft.trim();
    const payload =
      kind === 'text'
        ? encodeTextAsBase64(note)
        : kind === 'photo'
          ? photoBase64
          : voiceBase64;
    const mimeType =
      kind === 'text'
        ? 'text/plain'
        : kind === 'photo'
          ? photoMimeType ?? 'image/jpeg'
          : 'audio/m4a';

    if (!payload) {
      Alert.alert('Add your memory first', kind === 'photo' ? 'Pick a photo to share.' : kind === 'voice' ? 'Record a voice note to share.' : 'Write a memory to share.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .rpc('upload_daily_memory', {
        circle_id_input: circleId,
        kind_input: kind,
        title_input: note ? note.slice(0, 42) : defaultTitle(kind),
        note_input: note,
        content_base64_input: payload,
        content_mime_type_input: mimeType,
        memory_date_input: currentDate,
      })
      .single();

    setLoading(false);

    if (error) {
      Alert.alert('Could not upload memory', error.message);
      return;
    }

    setDraft('');
    setPhotoBase64(null);
    setPhotoMimeType(null);
    setVoiceBase64(null);
    setMemories((current) => [data as Memory, ...current]);
    await refreshMemories();
  }

  async function saveNickname() {
    const { data, error } = await supabase
      .rpc('update_circle_nickname', {
        circle_id_input: circleId,
        nickname_input: nicknameDraft,
      })
      .single();

    if (error) {
      Alert.alert('Could not save nickname', error.message);
      return;
    }

    const nextNickname = (data as { nickname: string | null }).nickname;
    setNickname(nextNickname);
    setNicknameDraft(nextNickname ?? '');
    await refreshCircleProfile();
  }

  async function pickCircleAvatar() {
    if (!canManageCircle) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo permission needed', 'Allow photo access to choose a circle picture.');
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
    setCircleAvatarBase64(asset.base64 ?? null);
    setCircleAvatarMimeType(asset.mimeType ?? 'image/jpeg');
  }

  async function saveCircleProfile() {
    if (!circleNameDraft.trim()) {
      Alert.alert('Name your circle first');
      return;
    }

    const { data, error } = await supabase
      .rpc('update_circle_profile', {
        circle_id_input: circleId,
        name_input: circleNameDraft.trim(),
        avatar_base64_input: circleAvatarBase64,
        avatar_mime_type_input: circleAvatarMimeType,
      })
      .single();

    if (error) {
      Alert.alert('Could not save circle profile', error.message);
      return;
    }

    setCircle(data as Circle);
  }

  async function approveRequest(requestId: string) {
    const { error } = await supabase.rpc('approve_join_request', { request_id_input: requestId });

    if (error) {
      Alert.alert('Could not approve request', error.message);
      return;
    }

    await refreshCircleProfile();
    await refreshInteractions();
  }

  async function rejectRequest(requestId: string) {
    const { error } = await supabase.rpc('reject_join_request', { request_id_input: requestId });

    if (error) {
      Alert.alert('Could not reject request', error.message);
      return;
    }

    await refreshCircleProfile();
  }

  async function changeMemberRole(member: CircleMember, role: 'admin' | 'member') {
    const { error } = await supabase.rpc('update_circle_member_role', {
      circle_id_input: circleId,
      member_id_input: member.user_id,
      role_input: role,
    });

    if (error) {
      Alert.alert('Could not update role', error.message);
      return;
    }

    await refreshCircleProfile();
  }

  function confirmRemoveMember(member: CircleMember) {
    const displayName = member.nickname || member.default_username || 'this member';
    Alert.alert('Remove member?', `Remove ${displayName} from this circle?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMember(member) },
    ]);
  }

  async function removeMember(member: CircleMember) {
    const { error } = await supabase.rpc('remove_circle_member', {
      circle_id_input: circleId,
      member_id_input: member.user_id,
    });

    if (error) {
      Alert.alert('Could not remove member', error.message);
      return;
    }

    await refreshCircleProfile();
    await refreshInteractions();
  }

  function skipToNextDay() {
    setDebugDayOffset((current) => current + 1);
  }

  async function likeMemory(memory: Memory) {
    const interaction = interactions[memory.id] ?? { likeCount: 0, commentCount: 0, likedByMe: false };
    if (!interaction.likedByMe && likeState.likesLimit > 0 && likeState.likesUsed >= likeState.likesLimit) {
      Alert.alert('Daily likes used', `You can only like ${likeState.likesLimit} posts per day`);
      return;
    }

    const { error } = await supabase.rpc('like_memory', {
      memory_id_input: memory.id,
      like_date_input: currentDate,
    });

    if (error) {
      Alert.alert('Could not like memory', error.message);
      return;
    }

    await refreshInteractions();
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.iconButton}>{'<'}</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={styles.title}>{circle?.name ?? 'Memory Circle'}</Text>
          {!!nickname && <Text numberOfLines={1} style={styles.nickname}>as {nickname}</Text>}
          <Text style={styles.headerStats}>{memberCount} members - {memories.length} memories</Text>
        </View>
        <Pressable onPress={() => setProfileOpen(true)} style={styles.profileButton}>
          {circle?.avatar_base64 ? (
            <Image source={{ uri: `data:${circle.avatar_mime_type ?? 'image/jpeg'};base64,${circle.avatar_base64}` }} style={styles.profileImage} />
          ) : (
            <Text style={styles.profileIcon}>{circle?.name.slice(0, 1).toUpperCase() ?? 'P'}</Text>
          )}
        </Pressable>
      </View>

      {debugDayOffset > 0 && (
        <View style={styles.debugBanner}>
          <Text style={styles.debugText}>Debug date: {currentDate}</Text>
        </View>
      )}

      {syncing && (
        <View style={styles.syncBubbleWrap}>
          <Animated.View
            style={[
              styles.syncBubble,
              {
                transform: [
                  {
                    rotate: spin.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={[styles.syncDot, styles.syncDotTop]} />
            <View style={[styles.syncDot, styles.syncDotRight]} />
            <View style={[styles.syncDot, styles.syncDotBottom]} />
          </Animated.View>
          <Text style={styles.syncBubbleText}>remembering all the good memories</Text>
        </View>
      )}

      {!hasUploadedToday && (
        <View style={styles.uploadPanel}>
          <Tape style={styles.uploadTape} color={colors.roseSoft} />
          <Text style={styles.uploadTitle}>Upload today's memory Gem {'<3'}</Text>
          <Text style={styles.uploadSubtitle}>One memory a day keeps the moments alive.</Text>
          {kind === 'text' && (
            <TextInput
              multiline
              onChangeText={setDraft}
              placeholder="Write your memory..."
              placeholderTextColor={colors.muted}
              style={styles.memoryInput}
              value={draft}
            />
          )}
          {kind === 'photo' && (
            <View style={styles.mediaBox}>
              {photoBase64 ? (
                <Image source={{ uri: `data:${photoMimeType ?? 'image/jpeg'};base64,${photoBase64}` }} style={styles.mediaPreview} />
              ) : (
                <Text style={styles.mediaHint}>Pick a photo from your library.</Text>
              )}
              <Pressable onPress={pickPhoto} style={styles.mediaButton}>
                <Text style={styles.mediaButtonText}>{photoBase64 ? 'Choose Another Photo' : 'Choose Photo'}</Text>
              </Pressable>
            </View>
          )}
          {kind === 'voice' && (
            <View style={styles.mediaBox}>
              <Text style={styles.mediaHint}>
                {recording ? 'Recording...' : voiceBase64 ? 'Voice note ready.' : 'Record a short voice note.'}
              </Text>
              <Pressable onPress={toggleRecording} style={styles.mediaButton}>
                <Text style={styles.mediaButtonText}>{recording ? 'Stop Recording' : 'Record Voice Note'}</Text>
              </Pressable>
            </View>
          )}
          {kind !== 'text' && (
            <TextInput
              onChangeText={setDraft}
              placeholder="Add a caption..."
              placeholderTextColor={colors.muted}
              style={styles.captionInput}
              value={draft}
            />
          )}
          <View style={styles.uploadDividerRow}>
            <View style={styles.uploadDivider} />
            <Text style={styles.uploadDividerText}>or</Text>
            <View style={styles.uploadDivider} />
          </View>
          <View style={styles.kindRow}>
            <KindButton active={kind === 'text'} label="Text" symbol="T" onPress={() => setKind('text')} />
            <KindButton active={kind === 'voice'} label="Voice note" symbol="M" onPress={() => setKind('voice')} />
            <KindButton active={kind === 'photo'} label="Photo" symbol="P" onPress={() => setKind('photo')} />
          </View>
          <Pressable disabled={loading} onPress={uploadMemory} style={styles.uploadButton}>
            <Text style={styles.uploadButtonText}>{loading ? 'Saving...' : 'Share Memory'}</Text>
          </Pressable>
        </View>
      )}

      {hasUploadedToday && (
        <View style={styles.donePanel}>
          <Text style={styles.doneTitle}>Today's memory is tucked in.</Text>
          <Text style={styles.doneText}>Come back tomorrow to add a new one.</Text>
        </View>
      )}

      <SectionHeader title="New memories" detail={debugDayOffset > 0 ? currentDate : 'Today'} />
      <View style={styles.cardGrid}>
        {todayMemories.length === 0 && (
          <Text style={styles.emptyText}>No one has shared a memory today yet.</Text>
        )}
        {todayMemories.map((memory, index) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            authorName={memberNames[memory.author_id] ?? 'Someone'}
            index={index}
            currentDate={currentDate}
            interaction={interactions[memory.id]}
            likeDisabled={likeState.likesLimit > 0 && likeState.likesUsed >= likeState.likesLimit && !interactions[memory.id]?.likedByMe}
            likesLimit={likeState.likesLimit}
            onLike={() => likeMemory(memory)}
          />
        ))}
      </View>

      <View style={styles.tearLine} />

      <SectionHeader title="Today's memory gems" detail="From the past" />
      <View style={styles.gemRow}>
        {gems.length === 0 && (
          <Text style={styles.emptyText}>Past memories will appear here once this circle has history.</Text>
        )}
        {gems.map((memory, index) => (
          <MemoryCard
            key={memory.id}
            compact
            index={index}
            memory={memory}
            authorName={memberNames[memory.author_id] ?? 'Someone'}
            currentDate={currentDate}
            interaction={interactions[memory.id]}
            likeDisabled={likeState.likesLimit > 0 && likeState.likesUsed >= likeState.likesLimit && !interactions[memory.id]?.likedByMe}
            likesLimit={likeState.likesLimit}
            onLike={() => likeMemory(memory)}
          />
        ))}
      </View>

      <Pressable onPress={skipToNextDay} style={styles.debugSkipButton}>
        <Text style={styles.debugSkipText}>{'>'}</Text>
      </Pressable>

      <Modal animationType="fade" transparent visible={profileOpen} onRequestClose={() => setProfileOpen(false)}>
        <View style={styles.modalShade}>
          <View style={styles.profileCard}>
            <View style={styles.profileHeader}>
              <Text style={styles.profileTitle}>Circle profile</Text>
              <Pressable onPress={() => setProfileOpen(false)}>
                <Text style={styles.closeButton}>x</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.profileScroll}>
              <View style={styles.circleProfilePreview}>
                <Pressable disabled={!canManageCircle} onPress={pickCircleAvatar} style={styles.circleAvatarButton}>
                  {circleAvatarBase64 ? (
                    <Image source={{ uri: `data:${circleAvatarMimeType ?? 'image/jpeg'};base64,${circleAvatarBase64}` }} style={styles.circleAvatarImage} />
                  ) : (
                    <Text style={styles.circleAvatarInitial}>{circle?.name.slice(0, 1).toUpperCase() ?? 'S'}</Text>
                  )}
                </Pressable>
                <Text style={styles.rolePill}>{myRole}</Text>
                <Text style={styles.profileHelp}>
                  {canManageCircle ? 'Manage this circle profile and members.' : 'Choose the nickname people in this circle will see for you.'}
                </Text>
              </View>

              {canManageCircle && (
                <View style={styles.profileSection}>
                  <Text style={styles.profileSectionTitle}>Circle</Text>
                  <TextInput
                    onChangeText={setCircleNameDraft}
                    placeholder="Circle name"
                    placeholderTextColor={colors.muted}
                    style={styles.nicknameInput}
                    value={circleNameDraft}
                  />
                  <Pressable onPress={pickCircleAvatar} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>{circleAvatarBase64 ? 'Change Circle Photo' : 'Choose Circle Photo'}</Text>
                  </Pressable>
                  <Pressable onPress={saveCircleProfile} style={styles.saveButton}>
                    <Text style={styles.saveButtonText}>Save Circle Profile</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.profileSection}>
                <Text style={styles.profileSectionTitle}>Your nickname</Text>
                <TextInput
                  onChangeText={setNicknameDraft}
                  placeholder="Nickname for this circle"
                  placeholderTextColor={colors.muted}
                  style={styles.nicknameInput}
                  value={nicknameDraft}
                />
                <Pressable onPress={saveNickname} style={styles.saveButton}>
                  <Text style={styles.saveButtonText}>Save Nickname</Text>
                </Pressable>
              </View>

              <View style={styles.profileSection}>
                <Text style={styles.profileSectionTitle}>Invite code</Text>
                <View style={styles.inviteBox}>
                  <Text style={styles.inviteCode}>{circle?.invite_code}</Text>
                  <Text style={styles.inviteHint}>New people now send a request before joining.</Text>
                </View>
              </View>

              {canManageCircle && joinRequests.length > 0 && (
                <View style={styles.profileSection}>
                  <Text style={styles.profileSectionTitle}>Join requests</Text>
                  {joinRequests.map((request) => (
                    <View key={request.id} style={styles.memberRow}>
                      <MemberAvatar
                        avatarBase64={request.avatar_base64}
                        avatarMimeType={request.avatar_mime_type}
                        name={request.requester_name}
                      />
                      <View style={styles.memberInfo}>
                        <Text numberOfLines={1} style={styles.memberName}>{request.requester_name}</Text>
                        <Text style={styles.memberMeta}>wants to join</Text>
                      </View>
                      <Pressable onPress={() => approveRequest(request.id)} style={styles.smallApproveButton}>
                        <Text style={styles.smallButtonText}>Accept</Text>
                      </Pressable>
                      <Pressable onPress={() => rejectRequest(request.id)} style={styles.smallRejectButton}>
                        <Text style={styles.smallRejectText}>No</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.profileSection}>
                <Text style={styles.profileSectionTitle}>Members</Text>
                {members.map((member) => {
                  const displayName = member.nickname || member.default_username || 'Someone';
                  const canEditMember = canManageCircle && member.user_id !== currentUserId && member.role !== 'owner';
                  const ownerCanChangeRole = myRole === 'owner' && member.role !== 'owner';

                  return (
                    <View key={member.user_id} style={styles.memberRow}>
                      <MemberAvatar
                        avatarBase64={member.avatar_base64}
                        avatarMimeType={member.avatar_mime_type}
                        name={displayName}
                      />
                      <View style={styles.memberInfo}>
                        <Text numberOfLines={1} style={styles.memberName}>{displayName}</Text>
                        <Text style={styles.memberMeta}>{member.role}</Text>
                      </View>
                      {ownerCanChangeRole && (
                        <Pressable
                          onPress={() => changeMemberRole(member, member.role === 'admin' ? 'member' : 'admin')}
                          style={styles.smallRoleButton}
                        >
                          <Text style={styles.smallRoleText}>{member.role === 'admin' ? 'Member' : 'Admin'}</Text>
                        </Pressable>
                      )}
                      {canEditMember && (
                        <Pressable onPress={() => confirmRemoveMember(member)} style={styles.smallRejectButton}>
                          <Text style={styles.smallRejectText}>Kick</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function defaultTitle(kind: MemoryKind) {
  if (kind === 'photo') return 'Photo memory';
  if (kind === 'voice') return 'Voice note';
  return "Today's memory";
}

function KindButton(props: { active: boolean; label: string; symbol: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.kindButton}>
      <View style={[styles.kindIcon, props.active && styles.activeKindIcon]}>
        <Text style={styles.kindSymbol}>{props.symbol}</Text>
      </View>
      <Text style={styles.kindLabel}>{props.label}</Text>
    </Pressable>
  );
}

function Tape(props: { color: string; style?: object }) {
  return (
    <View style={[styles.tapeBase, { backgroundColor: props.color }, props.style]}>
      <View style={styles.tapeStripe} />
      <View style={[styles.tapeStripe, styles.tapeStripeLower]} />
    </View>
  );
}

function SectionHeader(props: { title: string; detail: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      <Text style={styles.sectionDetail}>{props.detail}</Text>
    </View>
  );
}

function MemberAvatar(props: { avatarBase64: string | null; avatarMimeType: string | null; name: string }) {
  return props.avatarBase64 ? (
    <Image source={{ uri: `data:${props.avatarMimeType ?? 'image/jpeg'};base64,${props.avatarBase64}` }} style={styles.memberAvatarImage} />
  ) : (
    <View style={styles.memberAvatarFallback}>
      <Text style={styles.memberAvatarText}>{props.name.slice(0, 1).toUpperCase() || '?'}</Text>
    </View>
  );
}

function MemoryCard(props: {
  memory: Memory;
  authorName: string;
  index: number;
  currentDate: string;
  interaction?: MemoryInteraction;
  likeDisabled: boolean;
  likesLimit: number;
  onLike: () => void;
  compact?: boolean;
}) {
  const isPhoto = props.memory.kind === 'photo';
  const isVoice = props.memory.kind === 'voice';
  const isText = props.memory.kind === 'text';
  const tilt = props.index % 2 === 0 ? '-2deg' : '2deg';
  const tapeColor = props.index % 3 === 0 ? colors.roseSoft : props.index % 3 === 1 ? '#efd392' : colors.lilac;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/memory/[id]', params: { id: props.memory.id, circleId: props.memory.circle_id, currentDate: props.currentDate } })}
      style={[
        styles.memoryCard,
        isText && styles.stickyMemoryCard,
        props.compact && styles.compactCard,
        { transform: [{ rotate: tilt }] },
      ]}
    >
      <Tape color={tapeColor} style={styles.cardTape} />
      {isPhoto ? (
        props.memory.content_base64 ? (
          <Image
            source={{ uri: `data:${props.memory.content_mime_type ?? 'image/jpeg'};base64,${props.memory.content_base64}` }}
            style={styles.photoMemory}
          />
        ) : (
          <View style={styles.photoMemory}>
            <Text style={styles.photoMemoryText}>Photo</Text>
          </View>
        )
      ) : isVoice ? (
        <View style={styles.voiceMemory}>
          <Text style={styles.waveform}>|||| ||| |||||| ||</Text>
          <Text style={styles.playButton}>Play</Text>
        </View>
      ) : (
        <View style={styles.noteMemory}>
          <Text style={styles.noteDate}>{formatMemoryDate(props.memory.memory_date, props.currentDate)}</Text>
          <Text numberOfLines={props.compact ? 3 : 6} style={styles.noteText}>{props.memory.note}</Text>
          <Text numberOfLines={1} style={styles.noteSignature}>- {props.authorName}</Text>
          <View style={styles.noteFold} />
        </View>
      )}
      {!isText && <Text numberOfLines={2} style={styles.memoryTitle}>{props.memory.title}</Text>}
      {!isText && (
        <View style={styles.memoryMetaRow}>
          <Text style={styles.memoryMeta}>{formatMemoryDate(props.memory.memory_date, props.currentDate)}</Text>
          <Text numberOfLines={1} style={styles.memorySignature}>{props.authorName}</Text>
        </View>
      )}
      <View style={styles.interactionRow}>
        <Pressable
          onPress={props.onLike}
          style={[styles.interactionButton, props.likeDisabled && styles.disabledInteraction]}
        >
          <Text style={[styles.interactionText, props.likeDisabled && styles.disabledInteractionText]}>
            Like {props.interaction?.likeCount ?? 0}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/memory/[id]', params: { id: props.memory.id, circleId: props.memory.circle_id, currentDate: props.currentDate } })} style={styles.interactionButton}>
          <Text style={styles.interactionText}>Comment {props.interaction?.commentCount ?? 0}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function formatMemoryDate(value: string, currentDate: string) {
  if (value === currentDate) {
    return 'Today';
  }

  return value;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
    padding: spacing.lg,
    paddingTop: 58,
    gap: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  iconButton: {
    width: 34,
    color: colors.ink,
    fontSize: 26,
    textAlign: 'center',
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: colors.ink,
    fontFamily: handwrittenFont,
    fontSize: 31,
  },
  nickname: {
    color: colors.rose,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  syncText: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  headerStats: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
    fontWeight: '700',
  },
  profileButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  profileIcon: {
    color: colors.ink,
    fontWeight: '700',
  },
  profileImage: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  debugBanner: {
    alignSelf: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.paperDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  debugText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  syncBubbleWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  syncBubble: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.rose,
  },
  syncDot: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.roseSoft,
  },
  syncDotTop: {
    top: -3,
    left: 18,
  },
  syncDotRight: {
    right: -2,
    top: 22,
    backgroundColor: colors.lilac,
  },
  syncDotBottom: {
    bottom: 0,
    left: 8,
    backgroundColor: '#efd392',
  },
  syncBubbleText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  uploadPanel: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.roseSoft,
    borderRadius: radius.md,
    backgroundColor: '#fff7f7',
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  tapeBase: {
    position: 'absolute',
    width: 70,
    height: 24,
    opacity: 0.92,
    overflow: 'hidden',
  },
  tapeStripe: {
    position: 'absolute',
    left: -8,
    right: -8,
    top: 6,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.42)',
    transform: [{ rotate: '-8deg' }],
  },
  tapeStripeLower: {
    top: 15,
    backgroundColor: 'rgba(47,41,38,0.08)',
  },
  uploadTape: {
    top: -12,
    left: 18,
    transform: [{ rotate: '-9deg' }],
  },
  uploadTitle: {
    color: colors.ink,
    fontFamily: handwrittenFont,
    fontSize: 34,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 36,
  },
  uploadSubtitle: {
    color: colors.ink,
    fontFamily: handwrittenFont,
    fontSize: 19,
    textAlign: 'center',
    marginTop: -spacing.sm,
    lineHeight: 21,
  },
  memoryInput: {
    minHeight: 86,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.paper,
    textAlignVertical: 'top',
  },
  uploadDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  uploadDivider: {
    flex: 1,
    height: 1,
    borderStyle: 'dotted',
    borderWidth: 1,
    borderColor: colors.line,
    borderTopWidth: 0,
  },
  uploadDividerText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  captionInput: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  mediaBox: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    padding: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
  },
  mediaHint: {
    color: colors.muted,
    textAlign: 'center',
  },
  mediaButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lilac,
  },
  mediaButtonText: {
    color: colors.ink,
    fontWeight: '700',
  },
  mediaPreview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
  },
  kindRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  kindButton: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  kindIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paperDeep,
  },
  activeKindIcon: {
    backgroundColor: colors.roseSoft,
  },
  kindSymbol: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  kindLabel: {
    color: colors.ink,
    fontSize: 12,
    textAlign: 'center',
  },
  uploadButton: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  uploadButtonText: {
    color: colors.white,
    fontWeight: '700',
  },
  donePanel: {
    borderRadius: radius.md,
    backgroundColor: '#fff1f3',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.roseSoft,
  },
  doneTitle: {
    color: colors.ink,
    fontFamily: handwrittenFont,
    fontSize: 22,
  },
  doneText: {
    color: colors.muted,
    marginTop: spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
  },
  sectionDetail: {
    color: colors.muted,
    fontSize: 13,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gemRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  memoryCard: {
    width: '47.7%',
    minHeight: 224,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.sm,
    gap: spacing.sm,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  stickyMemoryCard: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    shadowOpacity: 0,
    gap: spacing.sm,
  },
  compactCard: {
    minHeight: 188,
  },
  cardTape: {
    top: -9,
    alignSelf: 'center',
    transform: [{ rotate: '3deg' }],
    zIndex: 1,
  },
  photoMemory: {
    width: '100%',
    aspectRatio: 0.92,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lilac,
  },
  photoMemoryText: {
    color: colors.white,
    fontWeight: '700',
  },
  voiceMemory: {
    width: '100%',
    aspectRatio: 0.92,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#eee2ff',
  },
  waveform: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
  },
  playButton: {
    color: colors.ink,
    fontWeight: '700',
  },
  noteMemory: {
    minHeight: 142,
    borderRadius: 2,
    backgroundColor: '#ffe89b',
    padding: spacing.md,
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  noteDate: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
  },
  noteText: {
    color: colors.ink,
    fontFamily: handwrittenFont,
    fontSize: 19,
    lineHeight: 27,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  noteSignature: {
    color: colors.ink,
    fontFamily: handwrittenFont,
    fontSize: 19,
    lineHeight: 22,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  noteFold: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 24,
    height: 24,
    borderTopWidth: 24,
    borderTopColor: '#f0c95e',
    borderRightWidth: 24,
    borderRightColor: '#fff4bd',
  },
  memoryTitle: {
    color: colors.ink,
    fontFamily: handwrittenFont,
    fontSize: 22,
    lineHeight: 25,
  },
  memoryMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  memoryMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  memorySignature: {
    flex: 1,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  interactionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 'auto',
  },
  interactionButton: {
    flex: 1,
    minHeight: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  interactionText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '700',
  },
  disabledInteraction: {
    backgroundColor: '#eeeeee',
    borderColor: '#dddddd',
  },
  disabledInteractionText: {
    color: colors.muted,
  },
  emptyText: {
    width: '100%',
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  tearLine: {
    height: 1,
    backgroundColor: colors.line,
  },
  debugSkipButton: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    shadowColor: colors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  debugSkipText: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
  },
  modalShade: {
    flex: 1,
    backgroundColor: 'rgba(47, 41, 38, 0.28)',
    justifyContent: 'flex-end',
  },
  profileCard: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.paper,
    padding: spacing.lg,
    gap: spacing.md,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileTitle: {
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
  profileHelp: {
    color: colors.muted,
    lineHeight: 20,
    textAlign: 'center',
  },
  profileScroll: {
    gap: spacing.lg,
    paddingBottom: spacing.md,
  },
  circleProfilePreview: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  circleAvatarButton: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.roseSoft,
    borderWidth: 2,
    borderColor: colors.white,
  },
  circleAvatarImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  circleAvatarInitial: {
    color: colors.white,
    fontSize: 38,
    fontWeight: '800',
  },
  rolePill: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    backgroundColor: colors.paperDeep,
  },
  profileSection: {
    gap: spacing.sm,
  },
  profileSectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  nicknameInput: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  inviteBox: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.xs,
  },
  inviteCode: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  inviteHint: {
    color: colors.muted,
    lineHeight: 18,
  },
  memberRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.sm,
  },
  memberAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  memberAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.roseSoft,
  },
  memberAvatarText: {
    color: colors.white,
    fontWeight: '800',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: colors.ink,
    fontWeight: '800',
  },
  memberMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lilac,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontWeight: '800',
  },
  smallApproveButton: {
    minHeight: 36,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  smallButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
  },
  smallRejectButton: {
    minHeight: 36,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  smallRejectText: {
    color: colors.rose,
    fontSize: 12,
    fontWeight: '800',
  },
  smallRoleButton: {
    minHeight: 36,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paperDeep,
  },
  smallRoleText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  saveButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  saveButtonText: {
    color: colors.white,
    fontWeight: '700',
  },
});
