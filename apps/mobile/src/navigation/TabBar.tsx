import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { tabEmphasis } from './tab-style';
import { tabs, type Tab } from './types';

export function TabBar({ activeTab, onChange }: { activeTab: Tab; onChange: (tab: Tab) => void }) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.nav} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = activeTab === tab;
        const quiet = tabEmphasis(tab) === 'quiet';
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityRole="tab"
            accessibilityLabel={tab}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
          >
            <Text style={[styles.navIcon, quiet && styles.quiet, selected && styles.active]}>
              {tab === 'Home'
                ? '⌂'
                : tab === 'Explore'
                  ? '⌖'
                  : tab === 'Season'
                    ? '⬡'
                    : tab === 'Clubs'
                      ? '◎'
                      : '◉'}
            </Text>
            <Text style={[styles.navText, quiet && styles.quiet, selected && styles.active]}>
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    nav: {
      backgroundColor: tokens.background.surface,
      borderColor: tokens.border.subtle,
      borderTopWidth: 1,
      bottom: 0,
      flexDirection: 'row',
      left: 0,
      minHeight: 76,
      paddingBottom: 8,
      position: 'absolute',
      right: 0
    },
    navItem: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 58,
      paddingTop: 6
    },
    navIcon: { color: tokens.text.secondary, fontSize: 20 },
    navText: { color: tokens.text.secondary, fontSize: 10, fontWeight: '800', marginTop: 3 },
    quiet: { color: tokens.text.tertiary },
    active: { color: tokens.action.selected },
    pressed: { opacity: 0.74 }
  });
