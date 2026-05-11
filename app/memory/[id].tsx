import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Memory } from '../../src/lib/memories';
import { supabase } from '../../src/lib/supabase';
import { colors, radius, spacing } from '../../src/theme';

export default function MemoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [memory, setMemory] = useState<Memory | null>(null);

  useEffect(() => {
    async function loadMemory() {
      const { data, error } = await supabase.from('memories').select('*').eq('id', id).single();

      if (error) {
        Alert.alert('Could not open memory', error.message);
        return;
      }

      setMemory(data as Memory);
    }

    loadMemory();
  }, [id]);

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.iconButton}>{'<'}</Text>
        </Pressable>
        <Text style={styles.iconButton}>...</Text>
      </View>

      <View style={styles.polaroid}>
        {memory?.kind === 'photo' && memory.content_base64 ? (
          <Image
            source={{ uri: `data:${memory.content_mime_type ?? 'image/jpeg'};base64,${memory.content_base64}` }}
            style={styles.photo}
          />
        ) : (
          <View style={styles.photo}>
            <Text style={styles.photoText}>{memory?.kind === 'voice' ? 'Voice note' : 'Note'}</Text>
          </View>
        )}
        <Text style={styles.title}>{memory?.title ?? 'Memory detail'}</Text>
        <Text style={styles.date}>{memory?.memory_date ?? ''}</Text>
        <Text style={styles.note}>{memory?.note ?? ''}</Text>
      </View>

      <View style={styles.actions}>
        <Text style={styles.action}>React</Text>
        <Text style={styles.action}>Comment</Text>
        <Text style={styles.action}>Save</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reactions</Text>
        <View style={styles.reactions}>
          {['Me', '+0'].map((item) => (
            <View key={item} style={styles.avatar}>
              <Text style={styles.avatarText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Comments</Text>
        <TextInput placeholder="Write a comment..." placeholderTextColor={colors.muted} style={styles.commentInput} />
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
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
  },
  date: {
    color: colors.muted,
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
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
});
