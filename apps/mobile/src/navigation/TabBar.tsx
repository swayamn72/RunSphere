import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { tabEmphasis, tabIcons } from './tab-style';
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
            {/* The lit pill is what reads as "you are here" at a glance; the
                tint alone is too small a cue at 20dp on a dark bar. */}
            <View style={[styles.iconWell, selected && styles.iconWellActive]}>
              <Text style={[styles.navIcon, quiet && styles.quiet, selected && styles.active]}>
                {tabIcons[tab]}
              </Text>
            </View>
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
      paddingBottom: 10,
      paddingTop: 8,
      position: 'absolute',
      right: 0
    },
    navItem: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 58
    },
    iconWell: {
      alignItems: 'center',
      borderRadius: 999,
      height: 30,
      justifyContent: 'center',
      width: 46
    },
    iconWellActive: { backgroundColor: tokens.action.primary + '1F' },
    navIcon: { color: tokens.text.secondary, fontSize: 19, lineHeight: 23 },
    navText: {
      color: tokens.text.secondary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.2,
      marginTop: 2
    },
    quiet: { color: tokens.text.tertiary },
    active: { color: tokens.action.selected },
    pressed: { opacity: 0.74 }
  });
