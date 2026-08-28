import type React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { MovementPreference } from '../onboarding';
import { styles } from './styles';

export function MovementChoice({
  selected,
  onChoose
}: {
  selected: MovementPreference;
  onChoose: (movement: MovementPreference) => void;
}) {
  const labels: Record<MovementPreference, [string, string]> = {
    walk: ['Walk', 'Every step counts'],
    run: ['Run', 'Find your pace'],
    hike: ['Hike', 'Explore farther']
  };
  return (
    <View style={styles.choiceGrid} accessibilityRole="radiogroup">
      {(Object.keys(labels) as MovementPreference[]).map((movement) => (
        <Pressable
          key={movement}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === movement }}
          accessibilityLabel={`Choose ${labels[movement][0].toLowerCase()}`}
          onPress={() => onChoose(movement)}
          style={[styles.choice, selected === movement && styles.choiceSelected]}
        >
          <Text style={styles.choiceTitle}>{labels[movement][0]}</Text>
          <Text style={styles.rowDetail}>{labels[movement][1]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function StepHeader({ step, onBack }: { step: string; onBack: () => void }) {
  return (
    <View style={styles.stepHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Text style={styles.stepText}>{step}</Text>
      <View style={styles.backButton} />
    </View>
  );
}

export function PermissionCard({
  icon,
  title,
  detail,
  badge
}: {
  icon: string;
  title: string;
  detail: string;
  badge: string;
}) {
  return (
    <View style={styles.permissionCard}>
      <Text style={styles.permissionIcon}>{icon}</Text>
      <View style={styles.flexCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      <Text style={[styles.badge, badge === 'Optional' && styles.optionalBadge]}>{badge}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        (pressed || disabled) && styles.buttonPressed,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={styles.primaryText}>{label}</Text>
      <Text style={styles.primaryArrow}>→</Text>
    </Pressable>
  );
}

export function Stat({
  label,
  value,
  suffix,
  detail
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueLine}>
        <Text style={styles.statValue}>{value}</Text>
        {suffix && <Text style={styles.statSuffix}>{suffix}</Text>}
      </View>
      <Text style={styles.statDetail}>{detail}</Text>
    </View>
  );
}

export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.settingsGroup}>
      <Text style={styles.settingsTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Setting({
  label,
  value,
  onPress,
  destructive = false,
  disabled = false
}: {
  label: string;
  value: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={[styles.setting, disabled && styles.settingDisabled]}
    >
      <Text style={[styles.rowTitle, destructive && styles.destructive]}>{label}</Text>
      <Text style={[styles.settingValue, destructive && styles.destructive]}>
        {value}
        {onPress ? ' ›' : ''}
      </Text>
    </Pressable>
  );
}
