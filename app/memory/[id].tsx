import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LikeState, MemoryComment, MemoryInteraction, loadCircleInteractions, loadMemoryComments, readCachedCircleInteractions } from '../../src/lib/interactions';
import { deleteLocalMemory } from '../../src/lib/localDb';
import { Memory, readCachedMemories } from '../../src/lib/memories';
import { todayKey } from '../../src/lib/memories';
import { supabase } from '../../src/lib/supabase';
import { colors, fonts, radius, spacing } from '../../src/theme';

export default function MemoryDetailScreen() {
  const { id, circleId, currentDate: currentDateParam } = useLocalSearchParams<{ id: string; circleId?: string; currentDate?: string }>();
  const [memory, setMemory] = useState<Memory | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<MemoryInteraction>({ likeCount: 0, commentCount: 0, likedByMe: false });
  const [likeState, setLikeState] = useState<LikeState>({ likesLimit: 0, likesUsed: 0 });
  const [comments, setComments] = useState<MemoryComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [authorName, setAuthorName] = useState('Someone');
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const currentDate = currentDateParam ?? todayKey();
  const isOwnMemory = !!memory && memory.author_id === currentUserId;

  const refreshInteractions = useCallback(async (nextMemory: Memory) => {
    const interactionResult = await loadCircleInteractions(nextMemory.circle_id, currentDate, currentUserId);
    const commentsResult = await loadMemoryComments(nextMemory.id, nextMemory.circle_id);

    if (interactionResult.error ?? commentsResult.error) {
      Alert.alert('Could not load interactions', interactionResult.error?.message ?? commentsResult.error?.message);
      return;
    }

    setInteraction(interactionResult.interactions[nextMemory.id] ?? { likeCount: 0, commentCount: 0, likedByMe: false });
    setLikeState(interactionResult.likeState);
    setComments(commentsResult.comments);
  }, [currentDate, currentUserId]);

  useEffect(() => {
    async function loadMemory() {
      const [{ data: userData }, memoryResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('memories').select('*').eq('id', id).single(),
      ]);

      const { data, error } = memoryResult;
      setCurrentUserId(userData.user?.id ?? null);

      if (error) {
        if (!circleId) {
          Alert.alert('Could not open memory', error.message);
          return;
        }

        const cached = await readCachedMemories(circleId);
        const cachedMemory = cached.memories.find((item) => item.id === id);
        if (!cachedMemory) {
          Alert.alert('Could not open memory', error.message);
          return;
        }

        setMemory(cachedMemory);
        const cachedInteractions = await readCachedCircleInteractions(circleId);
        setInteraction(cachedInteractions?.interactions[cachedMemory.id] ?? { likeCount: 0, commentCount: 0, likedByMe: false });
        setLikeState(cachedInteractions?.likeState ?? { likesLimit: 0, likesUsed: 0 });
        setComments((cachedInteractions?.comments ?? []).filter((comment) => comment.memory_id === cachedMemory.id));
        setAuthorName(cachedInteractions?.memberNames[cachedMemory.author_id] ?? 'Someone');
        return;
      }

      const nextMemory = data as Memory;
      if (nextMemory.deleted_at) {
        Alert.alert('Memory removed', 'This memory is no longer available.');
        await deleteLocalMemory(nextMemory.id);
        router.back();
        return;
      }

      setMemory(nextMemory);

      const { data: membership } = await supabase
        .from('circle_members')
        .select('nickname')
        .eq('circle_id', nextMemory.circle_id)
        .eq('user_id', nextMemory.author_id)
        .single();

      setAuthorName(membership?.nickname ?? 'Someone');
      await refreshInteractions(nextMemory);
    }

    loadMemory();
  }, [id, refreshInteractions]);

  async function likeMemory() {
    if (!memory) return;

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

    await refreshInteractions(memory);
  }

  async function addComment() {
    if (!memory) return;

    const { error } = await supabase.rpc('add_memory_comment', {
      memory_id_input: memory.id,
      body_input: commentDraft,
    });

    if (error) {
      Alert.alert('Could not add comment', error.message);
      return;
    }

    setCommentDraft('');
    await refreshInteractions(memory);
  }

  async function deleteMemory() {
    if (!memory) return;

    const { error } = await supabase.rpc('delete_memory', {
      memory_id_input: memory.id,
    });

    if (error) {
      Alert.alert('Could not delete memory', error.message);
      return;
    }

    await deleteLocalMemory(memory.id);
    setOptionsVisible(false);
    router.back();
  }

  function confirmDeleteMemory() {
    Alert.alert(
      'Delete this memory?',
      'This removes the memory from the circle for everyone after their next sync.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteMemory },
      ],
    );
  }

  async function reportMemory() {
    if (!memory) return;

    const { error } = await supabase.rpc('report_memory', {
      memory_id_input: memory.id,
      reason_input: reportReason.trim() || 'No reason provided',
    });

    if (error) {
      Alert.alert('Could not report memory', error.message);
      return;
    }

    setReportReason('');
    setOptionsVisible(false);
    Alert.alert('Report sent', 'Thank you. The report has been saved for review.');
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.iconButton}>{'<'}</Text>
        </Pressable>
        <Pressable onPress={() => setOptionsVisible(true)}>
          <Text style={styles.iconButton}>...</Text>
        </Pressable>
      </View>

      <Modal transparent animationType="fade" visible={optionsVisible} onRequestClose={() => setOptionsVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOptionsVisible(false)}>
          <Pressable style={styles.optionsSheet}>
            <View style={styles.optionsHeader}>
              <Text style={styles.optionsTitle}>Memory options</Text>
              <Pressable onPress={() => setOptionsVisible(false)}>
                <Text style={styles.closeText}>x</Text>
              </Pressable>
            </View>

            {isOwnMemory ? (
              <>
                <Text style={styles.optionsCopy}>You can remove your own memory from this circle.</Text>
                <Pressable onPress={confirmDeleteMemory} style={[styles.optionButton, styles.deleteButton]}>
                  <Text style={styles.deleteButtonText}>Delete Memory</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.optionsCopy}>Report this memory if it should be reviewed.</Text>
                <TextInput
                  multiline
                  onChangeText={setReportReason}
                  placeholder="Reason for reporting..."
                  placeholderTextColor={colors.muted}
                  style={styles.reportInput}
                  value={reportReason}
                />
                <Pressable onPress={reportMemory} style={styles.optionButton}>
                  <Text style={styles.optionButtonText}>Report Memory</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.polaroid}>
        {memory?.kind === 'photo' && memory.content_base64 ? (
          <>
            <Image
              source={{ uri: `data:${memory.content_mime_type ?? 'image/jpeg'};base64,${memory.content_base64}` }}
              style={styles.photo}
            />
            <Text style={styles.title}>{memory?.title ?? 'Memory detail'}</Text>
          </>
        ) : memory?.kind === 'text' ? (
          <View style={styles.textNote}>
            <Text style={styles.textNoteDate}>{memory.memory_date}</Text>
            <Text style={styles.textNoteBody}>{memory.note}</Text>
            <Text style={styles.textNoteSignature}>- {authorName}</Text>
            <View style={styles.textNoteFold} />
          </View>
        ) : (
          <View style={styles.photo}>
            <Text style={styles.photoText}>Voice note</Text>
          </View>
        )}
        {memory?.kind === 'voice' && <Text style={styles.title}>{memory?.title ?? 'Voice note'}</Text>}
        <View style={styles.memoryMetaRow}>
          <Text style={styles.date}>{memory?.memory_date ?? ''}</Text>
          <Text numberOfLines={1} style={styles.signature}>{authorName}</Text>
        </View>
        {!!memory?.note && memory.kind !== 'text' && <Text style={styles.note}>{memory.note}</Text>}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={likeMemory}
          style={[
            styles.actionButton,
            !interaction.likedByMe && likeState.likesLimit > 0 && likeState.likesUsed >= likeState.likesLimit && styles.disabledAction,
          ]}
        >
          <Text style={styles.action}>Like {interaction.likeCount}</Text>
        </Pressable>
        <Text style={styles.action}>Comments {comments.length}</Text>
        <Text style={styles.action}>Save</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Likes</Text>
        <View style={styles.reactions}>
          {[interaction.likedByMe ? 'Me' : 'Likes', `${interaction.likeCount}`].map((item) => (
            <View key={item} style={styles.avatar}>
              <Text style={styles.avatarText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Comments</Text>
        {comments.map((comment) => (
          <View key={comment.id} style={styles.commentBubble}>
            <Text style={styles.commentBody}>{comment.body}</Text>
          </View>
        ))}
        <View style={styles.commentComposer}>
          <TextInput
            onChangeText={setCommentDraft}
            placeholder="Write a comment..."
            placeholderTextColor={colors.muted}
            style={styles.commentInput}
            value={commentDraft}
          />
          <Pressable onPress={addComment} style={styles.commentButton}>
            <Text style={styles.commentButtonText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: spacing.lg,
    paddingTop: 58,
    gap: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    color: colors.ink,
    fontSize: 28,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(31, 27, 24, 0.34)',
  },
  optionsSheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.paper,
    padding: spacing.lg,
    gap: spacing.md,
  },
  optionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionsTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  closeText: {
    color: colors.muted,
    fontSize: 24,
    fontWeight: '800',
  },
  optionsCopy: {
    color: colors.muted,
    lineHeight: 20,
  },
  reportInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.white,
    textAlignVertical: 'top',
  },
  optionButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  optionButtonText: {
    color: colors.white,
    fontWeight: '800',
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.rose,
    backgroundColor: colors.white,
  },
  deleteButtonText: {
    color: colors.rose,
    fontWeight: '800',
  },
  polaroid: {
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffe89b',
  },
  photoText: {
    color: colors.ink,
    fontWeight: '700',
  },
  textNote: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffe89b',
    padding: spacing.lg,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  textNoteDate: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  textNoteBody: {
    color: colors.ink,
    fontFamily: fonts.handwriting,
    fontSize: 22,
    lineHeight: 31,
    textAlign: 'center',
  },
  textNoteSignature: {
    color: colors.ink,
    fontFamily: fonts.handwriting,
    fontSize: 24,
    lineHeight: 28,
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
  },
  textNoteFold: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderTopWidth: 34,
    borderTopColor: '#f0c95e',
    borderRightWidth: 34,
    borderRightColor: '#fff4bd',
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.handwriting,
    fontSize: 28,
    lineHeight: 31,
  },
  date: {
    color: colors.muted,
  },
  memoryMetaRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  signature: {
    flex: 1,
    color: colors.ink,
    fontWeight: '700',
    textAlign: 'right',
  },
  note: {
    color: colors.ink,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  actions: {
    minHeight: 66,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.white,
  },
  action: {
    color: colors.ink,
    fontWeight: '700',
  },
  actionButton: {
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledAction: {
    backgroundColor: '#eeeeee',
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  reactions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.roseSoft,
  },
  avatarText: {
    color: colors.ink,
    fontWeight: '700',
  },
  commentInput: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
  commentBubble: {
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  commentBody: {
    color: colors.ink,
    lineHeight: 20,
  },
  commentComposer: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  commentButton: {
    minHeight: 52,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  commentButtonText: {
    color: colors.white,
    fontWeight: '700',
  },
});
