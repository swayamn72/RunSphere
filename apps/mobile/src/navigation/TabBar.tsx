import { useMemo } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType
} from 'react-native';
import homeIcon from '../../assets/tabs/home.png';
import mapIcon from '../../assets/tabs/map.png';
import profileIcon from '../../assets/tabs/profile.png';
import runIcon from '../../assets/tabs/run.png';
import socialIcon from '../../assets/tabs/social.png';
import { useAppTheme } from '../theme/theme';
import { tabEmphasis } from './tab-style';
import { tabs, type Tab } from './types';
import { gameWorld } from '../theme/game-world';
import { TutorialTarget } from '../components/TutorialTarget';

const tabIconAssets: Record<Tab, ImageSourcePropType> = {
  Home: homeIcon,
  Map: mapIcon,
  Run: runIcon,
  Social: socialIcon,
  Profile: profileIcon
};

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
    <View style={[styles.nav, turf && styles.turfNav]} accessibilityRole="tablist">
      {turf && <View pointerEvents="none" style={styles.turfNavBackdrop} />}
      {tabs.map((tab) => {
        const selected = activeTab === tab;
        const quiet = tabEmphasis(tab) === 'quiet';
        const startRun = turf && tab === 'Run';
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityRole={startRun ? 'button' : 'tab'}
            accessibilityLabel={startRun ? 'Start Run' : tab}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.navItem,
              turf && !startRun && styles.turfNavItem,
              pressed && styles.pressed
            ]}
          >
            {/* The lit pill is what reads as "you are here" at a glance. */}
            <TutorialTarget id={`tab-${tab.toLowerCase()}`}>
              <View
                style={[
                  styles.iconWell,
                  selected && styles.iconWellActive,
                  startRun && styles.runOrb
                ]}
              >
                <Image
                  source={tabIconAssets[tab]}
                  style={[
                    styles.tabIconImage,
                    {
                      tintColor: startRun
                        ? gameWorld.orb.ink
                        : selected
                          ? tokens.action.selected
                          : quiet
                            ? tokens.text.tertiary
                            : tokens.text.secondary
                    }
                  ]}
                  resizeMode="contain"
                />
                {startRun && <Text style={styles.runLabel}>START RUN</Text>}
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
    turfNav: {
      backgroundColor: 'transparent',
      borderTopWidth: 0,
      paddingTop: 0,
      paddingBottom: Platform.OS === 'ios' ? 22 : 17
    },
    turfNavBackdrop: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      top: 18,
      backgroundColor: gameWorld.hud.glass,
      borderColor: gameWorld.hud.edge,
      borderTopWidth: 1
    },
    turfNavItem: { paddingTop: 18 },
    runOrb: {
      backgroundColor: gameWorld.orb.fill,
      borderColor: gameWorld.orb.rim,
      borderWidth: 2,
      height: 64,
      width: 64,
      borderRadius: 32,
      elevation: 12,
      shadowColor: gameWorld.orb.glow
    },
    runLabel: { color: gameWorld.orb.ink, fontSize: 8, fontWeight: '900' },
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
