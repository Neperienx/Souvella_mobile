import { router, useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Circle, supabase } from '../../src/lib/supabase';
import {
  Memory,
  MemoryKind,
  encodeTextAsBase64,
  selectMemoryGems,
  selectTodayMemories,
  syncCircleMemories,
  todayKey,
} from '../../src/lib/memories';
import { colors, radius, spacing } from '../../src/theme';

export default function CircleHomeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [debugDayOffset, setDebugDayOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Checking for memories...');

  const currentDate = useMemo(() => todayKey(debugDayOffset), [debugDayOffset]);
  const todayMemories = useMemo(() => selectTodayMemories(memories, currentDate), [memories, currentDate]);
  const gems = useMemo(() => selectMemoryGems(memories, 5, currentDate), [memories, currentDate]);
  const hasUploadedToday = todayMemories.some((memory) => memory.author_id === currentUserId);

  const refreshMemories = useCallback(async () => {
    if (!id) return;

    const result = await syncCircleMemories(id);
    setMemories(result.memories);
    setSyncMessage(result.synced ? 'Up to date for offline reading' : 'Offline cache shown');
  }, [id]);

  useEffect(() => {
    async function loadCircle() {
      const [{ data: userData }, circleResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('circles').select('*').eq('id', id).single(),
      ]);

      setCurrentUserId(userData.user?.id ?? null);

      if (circleResult.error) {
        Alert.alert('Could not open circle', circleResult.error.message);
        return;
      }

      setCircle(circleResult.data);

      if (userData.user) {
        const { data: membership } = await supabase
          .from('circle_members')
          .select('nickname')
          .eq('circle_id', id)
          .eq('user_id', userData.user.id)
          .single();

        setNickname(membership?.nickname ?? null);
        setNicknameDraft(membership?.nickname ?? '');
      }

      await refreshMemories();
    }

    loadCircle();
  }, [id, refreshMemories]);

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
        circle_id_input: id,
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
        circle_id_input: id,
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
    setProfileOpen(false);
  }

  function skipToNextDay() {
    setDebugDayOffset((current) => current + 1);
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
          <Text style={styles.syncText}>{syncMessage}</Text>
        </View>
        <Pressable onPress={() => setProfileOpen(true)} style={styles.profileButton}>
          <Text style={styles.profileIcon}>P</Text>
        </Pressable>
      </View>

      {debugDayOffset > 0 && (
        <View style={styles.debugBanner}>
          <Text style={styles.debugText}>Debug date: {currentDate}</Text>
        </View>
      )}

      {!hasUploadedToday && (
        <View style={styles.uploadPanel}>
          <View style={styles.tape} />
          <Text style={styles.uploadTitle}>Upload today's memory Gem</Text>
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
          <MemoryCard key={memory.id} memory={memory} index={index} currentDate={currentDate} />
        ))}
      </View>

      <View style={styles.tearLine} />

      <SectionHeader title="Today's memory gems" detail="From the past" />
      <View style={styles.gemRow}>
        {gems.length === 0 && (
          <Text style={styles.emptyText}>Past memories will appear here once this circle has history.</Text>
        )}
        {gems.map((memory, index) => (
          <MemoryCard key={memory.id} compact index={index} memory={memory} currentDate={currentDate} />
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
            <Text style={styles.profileHelp}>Choose the nickname people in this circle will see for you.</Text>
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

function SectionHeader(props: { title: string; detail: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      <Text style={styles.sectionDetail}>{props.detail}</Text>
    </View>
  );
}

function MemoryCard(props: { memory: Memory; index: number; currentDate: string; compact?: boolean }) {
  const isPhoto = props.memory.kind === 'photo';
  const isVoice = props.memory.kind === 'voice';
  const tilt = props.index % 2 === 0 ? '-2deg' : '2deg';
  const tapeColor = props.index % 3 === 0 ? colors.roseSoft : props.index % 3 === 1 ? '#efd392' : colors.lilac;

  return (
    <Pressable
      onPress={() => router.push(`/memory/${props.memory.id}`)}
      style={[
        styles.memoryCard,
        props.compact && styles.compactCard,
        { transform: [{ rotate: tilt }] },
      ]}
    >
      <View style={[styles.cardTape, { backgroundColor: tapeColor }]} />
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
          <Text numberOfLines={props.compact ? 3 : 6} style={styles.noteText}>{props.memory.note}</Text>
        </View>
      )}
      <Text numberOfLines={2} style={styles.memoryTitle}>{props.memory.title}</Text>
      <Text style={styles.memoryMeta}>{formatMemoryDate(props.memory.memory_date, props.currentDate)}</Text>
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
    fontSize: 23,
    fontWeight: '700',
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
  uploadPanel: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  tape: {
    position: 'absolute',
    top: -12,
    left: 18,
    width: 72,
    height: 28,
    backgroundColor: colors.roseSoft,
    transform: [{ rotate: '-9deg' }],
  },
  uploadTitle: {
    color: colors.rose,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  memoryInput: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.paper,
    textAlignVertical: 'top',
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
    fontSize: 13,
    textAlign: 'center',
  },
  uploadButton: {
    minHeight: 52,
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
    fontSize: 18,
    fontWeight: '700',
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
    fontSize: 26,
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
    minHeight: 232,
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
  compactCard: {
    minHeight: 188,
  },
  cardTape: {
    position: 'absolute',
    top: -9,
    alignSelf: 'center',
    width: 62,
    height: 22,
    opacity: 0.9,
    transform: [{ rotate: '3deg' }],
    zIndex: 1,
  },
  photoMemory: {
    width: '100%',
    aspectRatio: 1,
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
    aspectRatio: 1,
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
    minHeight: 126,
    borderRadius: radius.sm,
    backgroundColor: '#ffe89b',
    padding: spacing.md,
    justifyContent: 'center',
  },
  noteText: {
    color: colors.ink,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  memoryTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  memoryMeta: {
    color: colors.muted,
    fontSize: 12,
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
