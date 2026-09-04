import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { loopGuidance, type LoopGuidanceCue } from '../loop-guidance';
import { isSafeMascotLabel } from '../mascot';
import { useAppTheme } from '../theme/theme';
import { CrewMascot } from './CrewMascot';

/**
 * One guidance card, rendered by a crew member (milestone 2.8).
 *
 * Accessibility: the card is a single focusable unit that TalkBack announces
 * as "<speaker> says: <message>", so a screen reader never has to stitch the
 * mascot and the copy together. It is announced politely rather than as an
 * alert, because guidance is never urgent and never the only place the
 * information appears. The mascot itself is decorative — its label would
 * otherwise be read twice — and dismiss is a separate 48dp target with a hint
 * naming what dismissing does.
 */
export function LoopCallout({
  cue,
  onDismiss,
  action
}: {
  cue: LoopGuidanceCue;
  onDismiss: () => void;
  action?: { label: string; onPress: () => void };
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const copy = loopGuidance[cue];
  // The tone rule is enforced where the copy is rendered, not only in tests:
  // a cue that claimed authority would fail loudly rather than ship quietly.
  if (!isSafeMascotLabel(copy.message))
    throw new Error('Loop guidance cannot claim authority, rewards, or rejection.');

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${copy.speaker} says: ${copy.message}`}
      accessibilityLiveRegion="polite"
      style={styles.callout}
    >
      <CrewMascot character={copy.character} accessibility={{ mode: 'decorative' }} size={44} />
      <View style={styles.copy}>
        <Text style={styles.speaker}>{copy.speaker}</Text>
        <Text style={styles.message}>{copy.message}</Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            style={styles.action}
          >
            <Text style={styles.actionText}>{action.label}</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Dismiss guidance from ${copy.speaker}`}
        accessibilityHint="Hides this tip. Everything it describes stays on the screen."
        onPress={onDismiss}
        style={styles.dismiss}
      >
        <Text style={styles.dismissText}>✕</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (t: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    callout: {
      alignItems: 'flex-start',
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
      minHeight: 72,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    copy: { flex: 1 },
    speaker: { color: t.text.secondary, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    message: { color: t.text.primary, fontSize: 14, lineHeight: 20, marginTop: 4 },
    action: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 48,
      paddingHorizontal: 4
    },
    actionText: { color: t.action.primary, fontSize: 14, fontWeight: '900' },
    dismiss: { alignItems: 'center', justifyContent: 'center', minHeight: 48, minWidth: 48 },
    dismissText: { color: t.text.secondary, fontSize: 16, fontWeight: '900' }
  });
