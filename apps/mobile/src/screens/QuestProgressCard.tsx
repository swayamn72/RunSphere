import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../components/Text';
import type { MobileApiClient } from '../api-client';
import { useAppStyles } from '../components/styles';
import {
  QUEST_PROGRESS_COPY,
  progressFor,
  questActionFailure,
  type QuestProgress
} from './quest-progress-model';

/**
 * Take a quest on, see that you're on it, drop it, or see it's done (M6.3).
 * Signed-out readers (quests are browsable without an account) see nothing.
 */
export function QuestProgressCard({
  api,
  questId,
  onProgress
}: {
  api: Pick<MobileApiClient, 'listMyQuests' | 'acceptQuest' | 'dropQuest'>;
  questId: string;
  /** Told whenever the state changes, so the screen can offer a quest run. */
  onProgress?: (progress: QuestProgress) => void;
}) {
  const styles = useAppStyles();
  const [progress, setProgress] = useState<QuestProgress>();
  useEffect(() => {
    if (progress) onProgress?.(progress);
  }, [onProgress, progress]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .listMyQuests()
      .then((mine) => {
        if (active) setProgress(progressFor(questId, mine));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, questId]);

  const act = async (next: () => Promise<QuestProgress>) => {
    setBusy(true);
    try {
      setProgress(await next());
      setNotice('');
    } catch (error) {
      setNotice(questActionFailure(error));
    }
    setBusy(false);
  };

  if (!progress) return null;
  const copy = QUEST_PROGRESS_COPY[progress];
  return (
    <View style={styles.recordCard}>
      <Text style={styles.rowTitle}>{copy.title}</Text>
      <Text style={styles.rowDetail}>{copy.detail}</Text>
      {progress === 'not-taken' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take this quest"
          disabled={busy}
          onPress={() =>
            void act(async () =>
              (await api.acceptQuest(questId)).status === 'completed' ? 'done' : 'taken'
            )
          }
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>Take it on</Text>
        </Pressable>
      )}
      {progress === 'taken' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Drop this quest"
          disabled={busy}
          onPress={() =>
            void act(async () => {
              await api.dropQuest(questId);
              return 'not-taken';
            })
          }
        >
          <Text style={styles.textButton}>Drop it</Text>
        </Pressable>
      )}
      {notice !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
          {notice}
        </Text>
      )}
    </View>
  );
}
