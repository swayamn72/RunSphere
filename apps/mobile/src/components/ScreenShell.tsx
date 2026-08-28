import type React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../theme/theme';

/** Scrolling tab screens own their scroll view and reserve the visible tab bar. */
export function TabScrollShell({ children }: { children: React.ReactNode }) {
  const { tokens } = useAppTheme();
  return (
    <ScrollView
      contentContainerStyle={[styles.tabContent, { backgroundColor: tokens.background.canvas }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** Preparation, detail, and results can reflow safely at large Android font scales. */
export function FocusedScrollShell({ children }: { children: React.ReactNode }) {
  const { tokens } = useAppTheme();
  return (
    <ScrollView
      contentContainerStyle={[styles.focusedContent, { backgroundColor: tokens.background.canvas }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** Reserved for a future interactive Live/map surface that must own flex gestures. */
export function FocusedFlexShell({ children }: { children: React.ReactNode }) {
  const { tokens } = useAppTheme();
  return (
    <View style={[styles.focusedFlex, { backgroundColor: tokens.background.canvas }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tabContent: { flexGrow: 1, padding: 20, paddingBottom: 118 },
  focusedContent: { flexGrow: 1, padding: 20, paddingBottom: 36 },
  focusedFlex: { flex: 1, padding: 20, paddingBottom: 16 }
});
