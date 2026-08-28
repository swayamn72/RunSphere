import type React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { resolveSheetState, type MapSheetState } from './map-model';

export interface MapListSheetProps {
  readonly state: MapSheetState;
  readonly onStateChange: (state: MapSheetState) => void;
  readonly title: string;
  readonly children: React.ReactNode;
}

/** A sheet state model with a complete non-map list mode for TalkBack and keyboard users. */
export function MapListSheet({ state, onStateChange, title, children }: MapListSheetProps) {
  const { tokens } = useAppTheme();
  const isList = state === 'list';
  const nextExpanded = resolveSheetState(state, 'expand');
  const nextCollapsed = resolveSheetState(state, 'collapse');
  const canExpand = state !== 'expanded';

  return (
    <View
      accessibilityViewIsModal={isList}
      style={[
        styles.sheet,
        { backgroundColor: tokens.background.surface, borderColor: tokens.border.subtle },
        state === 'collapsed' && styles.collapsed,
        state === 'half' && styles.half,
        (state === 'expanded' || isList) && styles.expanded
      ]}
    >
      <View style={[styles.handle, { backgroundColor: tokens.border.strong }]} />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.text.primary }]}>
          {isList ? `${title} list` : title}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isList ? 'Show map sheet' : 'Show full list'}
            onPress={() => onStateChange(isList ? 'half' : resolveSheetState(state, 'show-list'))}
            style={[
              styles.button,
              { backgroundColor: tokens.map.control, borderColor: tokens.border.subtle }
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[styles.buttonText, { color: tokens.map.controlText }]}
            >
              {isList ? 'Map' : 'List'}
            </Text>
          </Pressable>
          {!isList && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={canExpand ? 'Expand map list' : 'Collapse map list'}
              onPress={() => onStateChange(canExpand ? nextExpanded : nextCollapsed)}
              style={[
                styles.button,
                { backgroundColor: tokens.map.control, borderColor: tokens.border.subtle }
              ]}
            >
              <Text
                allowFontScaling={false}
                style={[styles.buttonText, { color: tokens.map.controlText }]}
              >
                {canExpand ? 'Expand' : 'Collapse'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      {state !== 'collapsed' && <View>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    minHeight: 96,
    padding: 16
  },
  collapsed: { minHeight: 96 },
  half: { minHeight: 240 },
  expanded: { flex: 1, minHeight: 420 },
  handle: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 12, width: 40 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  title: { flex: 1, fontSize: 18, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8 },
  button: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12
  },
  buttonText: { fontSize: 14, fontWeight: '800' }
});
