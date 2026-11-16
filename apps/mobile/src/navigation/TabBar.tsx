import { useMemo } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { tabEmphasis } from './tab-style';
import { tabs, type Tab } from './types';

const tabIconAssets: Record<Tab, any> = {
  Home: require('../../assets/tabs/home.png'),
  Map: require('../../assets/tabs/map.png'),
  Run: require('../../assets/tabs/run.png'),
  Social: require('../../assets/tabs/social.png'),
  Profile: require('../../assets/tabs/profile.png')
};

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
            {/* The lit pill is what reads as "you are here" at a glance. */}
            <View style={[styles.iconWell, selected && styles.iconWellActive]}>
              <Image
                source={tabIconAssets[tab]}
                style={[
                  styles.tabIconImage,
                  {
                    tintColor: selected
                      ? tokens.action.selected
                      : quiet
                        ? tokens.text.tertiary
                        : tokens.text.secondary
                  }
                ]}
                resizeMode="contain"
              />
            </View>
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
    iconWell: {
      alignItems: 'center',
      borderRadius: 999,
      height: 44,
      justifyContent: 'center',
      width: 62
    },
    iconWellActive: {
      backgroundColor: tokens.action.primary + '26'
    },
    tabIconImage: {
      height: 30,
      width: 30
    },
    pressed: {
      opacity: 0.74,
      transform: [{ scale: 0.94 }]
    }
  });
