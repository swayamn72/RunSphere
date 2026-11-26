import type React from 'react';
import { space } from '@runsphere/ui';
import { useEffect, useRef } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View
} from 'react-native';
import { useAppTheme } from '../theme/theme';
import { tutorialTargets } from '../tutorial-targets';

/**
 * Keeps a focused text field above the keyboard. The app draws edge to edge,
 * which newer Android enforces, so the manifest's adjustResize no longer
 * shrinks the window: the screen has to make room itself, or the keyboard
 * covers the field being typed into.
 */
export function KeyboardSafe({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardSafe}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

/** Scrolling tab screens own their scroll view and reserve the visible tab bar. */
export function TabScrollShell({ children }: { children: React.ReactNode }) {
  const { tokens } = useAppTheme();
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  // The guided tour scrolls a spotlit target to about a third of the way down
  // (M9 9.22; found on a device: Home's Start actions start under the tab bar).
  useEffect(
    () =>
      tutorialTargets.onReveal((rect) => {
        const height = Dimensions.get('window').height;
        scroll.current?.scrollTo({
          y: Math.max(0, offset.current + rect.y - height * 0.3),
          animated: true
        });
      }),
    []
  );
  return (
    <KeyboardSafe>
      <ScrollView
        ref={scroll}
        scrollEventThrottle={64}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={[styles.tabContent, { backgroundColor: tokens.background.canvas }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // A settled scroll has moved every tour target on the tab (M9 9.22).
        onScrollEndDrag={tutorialTargets.requestMeasure}
        onMomentumScrollEnd={tutorialTargets.requestMeasure}
        // Found on a device: cards that load after the tour measured (the profile
        // prompt) push later targets down without firing their own onLayout, so
        // the ring stayed on the old spot. Content changing size moves them.
        onContentSizeChange={tutorialTargets.requestMeasure}
      >
        {children}
      </ScrollView>
    </KeyboardSafe>
  );
}

/** Preparation, detail, and results can reflow safely at large Android font scales. */
export function FocusedScrollShell({ children }: { children: React.ReactNode }) {
  const { tokens } = useAppTheme();
  return (
    <KeyboardSafe>
      <ScrollView
        contentContainerStyle={[
          styles.focusedContent,
          { backgroundColor: tokens.background.canvas }
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardSafe>
  );
}

/** Reserved for a future interactive Live/map surface that must own flex gestures. */
export function FocusedFlexShell({
  children,
  fullBleed = false
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
}) {
  const { tokens } = useAppTheme();
  return (
    <View
      style={[
        fullBleed ? styles.fullBleed : styles.focusedFlex,
        { backgroundColor: tokens.background.canvas }
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardSafe: { flex: 1 },
  tabContent: { flexGrow: 1, padding: space.xl, paddingBottom: 118 },
  focusedContent: { flexGrow: 1, padding: space.xl, paddingBottom: 36 },
  focusedFlex: { flex: 1, padding: space.xl, paddingBottom: space.lg },
  fullBleed: { flex: 1 }
});
