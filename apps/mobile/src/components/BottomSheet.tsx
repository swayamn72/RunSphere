import type React from 'react';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { radius, space, type SemanticTokens } from '@runsphere/ui';
import { useAppTheme } from '../theme/theme';
import { Text } from './Text';

/**
 * The one sheet for choices, confirmations and short explanations: a handle,
 * a title, a scrolling body and actions pinned underneath, over a scrim that
 * closes it. Screens use this instead of drawing their own modal card, so every
 * sheet drags, reads and closes the same way (component plan 4.9).
 */
export function BottomSheet({
  visible,
  title,
  onClose,
  children,
  actions
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons kept in view under the body, primary first. */
  actions?: React.ReactNode;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={styles.scrim}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.handle} />
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: t.scrim.strong },
    sheet: {
      backgroundColor: t.background.surface,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      maxHeight: '85%',
      paddingBottom: space.xl,
      paddingHorizontal: space.xl,
      paddingTop: space.md
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: t.border.strong,
      borderRadius: radius.pill,
      height: 4,
      marginBottom: space.md,
      width: 40
    },
    title: { color: t.text.primary, fontSize: 20, fontWeight: '700', marginBottom: space.md },
    body: { flexGrow: 0 },
    actions: { gap: space.md, paddingTop: space.lg }
  });
