import { Pressable, Text, View } from 'react-native';
import { styles } from '../components/styles';
import { tabs, type Tab } from './types';

export function TabBar({ activeTab, onChange }: { activeTab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View style={styles.nav} accessibilityRole="tablist">
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onChange(tab)}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === tab }}
          style={styles.navItem}
        >
          <Text style={[styles.navIcon, activeTab === tab && styles.navActive]}>
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
          <Text style={[styles.navText, activeTab === tab && styles.navActive]}>{tab}</Text>
        </Pressable>
      ))}
    </View>
  );
}
