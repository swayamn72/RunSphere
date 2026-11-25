import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, space, type SemanticTokens } from '@runsphere/ui';
import { useAppTheme } from '../theme/theme';
import { Text } from './Text';

/**
 * A short message that confirms something happened and goes away by itself.
 * It sits above the tab bar, is announced politely, and never holds a decision:
 * anything that needs an answer is a sheet or an inline notice, not a toast.
 */
export function Toast({
  message,
  onDone,
  durationMs = 4000
}: {
  message: string | undefined;
  onDone: () => void;
  durationMs?: number;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, durationMs);
    return () => clearTimeout(timer);
  }, [message, onDone, durationMs]);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View accessibilityLiveRegion="polite" style={styles.toast}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const createStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', bottom: 96, left: 0, position: 'absolute', right: 0 },
    toast: {
      backgroundColor: t.action.primary,
      borderRadius: radius.control,
      marginHorizontal: space.xl,
      paddingHorizontal: space.lg,
      paddingVertical: space.md
    },
    text: { color: t.text.onAccent, fontSize: 14, fontWeight: '600' }
  });
