import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useAppTheme } from '../theme/theme';
import { tabs, type Tab } from './types';
import { TutorialTarget } from '../components/TutorialTarget';

import { NavigationIcon } from '../components/NavigationIcon';

const tabIcons = {
  Home: 'home',
  Map: 'map',
  Run: 'runner',
  Social: 'social',
  Profile: 'profile'
} as const;

export function TabBar({
  activeTab,
  onChange,
  turf = false
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
  turf?: boolean;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.nav} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = activeTab === tab;
        const startRun = turf && tab === 'Run';
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityRole={startRun ? 'button' : 'tab'}
            accessibilityLabel={startRun ? 'Start Run' : tab}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
          >
            <TutorialTarget id={`tab-${tab.toLowerCase()}`}>
              <View style={styles.iconWell}>
                <NavigationIcon
                  name={tabIcons[tab]}
                  color={selected ? tokens.action.selected : tokens.text.primary}
                />
                <Text style={[styles.label, selected && styles.selectedLabel]}>{tab}</Text>
                {selected && <View style={styles.indicator} />}
              </View>
            </TutorialTarget>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    nav: {
      backgroundColor: tokens.background.canvas,
      borderColor: tokens.border.subtle,
      borderTopWidth: 1,
      bottom: 0,
      flexDirection: 'row',
      left: 0,
      minHeight: Platform.OS === 'ios' ? 84 : 68,
      paddingBottom: Platform.OS === 'ios' ? 22 : 10,
      paddingTop: 8,
      position: 'absolute',
      right: 0
    },
    navItem: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 50
    },
    iconWell: { alignItems: 'center', gap: 3 },
    label: {
      color: tokens.text.primary,
      fontSize: 11,
      fontWeight: '600'
    },
    selectedLabel: {
      color: tokens.action.selected,
      fontWeight: '700'
    },
    indicator: {
      position: 'absolute',
      bottom: -7,
      width: 38,
      height: 3,
      borderRadius: 2,
      backgroundColor: tokens.action.selected
    },
    pressed: {
      opacity: 0.74,
      transform: [{ scale: 0.94 }]
    }
  });
