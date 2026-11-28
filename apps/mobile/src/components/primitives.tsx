import type React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { useAppStyles } from './styles';
import { Chevron } from './Chevron';
import { Icon } from './Icon';
import { useAppTheme } from '../theme/theme';

export function StepHeader({ step, onBack }: { step: string; onBack: () => void }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  return (
    <View style={styles.stepHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backButton}
      >
        <Chevron direction="back" color={tokens.text.primary} />
      </Pressable>
      <Text style={styles.stepText}>{step}</Text>
      <View style={styles.backSpacer} />
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
  const styles = useAppStyles();
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
  disabled = false,
  accessibilityLabel
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * Stable name for a button whose visible label changes while it works, so a
   * screen reader is not told the control was renamed mid-action.
   */
  accessibilityLabel?: string;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
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
      <View style={styles.primaryArrow}>
        <Icon name="arrow-right" color={tokens.text.onAccent} size={20} />
      </View>
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
  const styles = useAppStyles();
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
  const styles = useAppStyles();
  return (
    <View style={styles.settingsGroup}>
      <Text accessibilityRole="header" style={styles.settingsTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * Header for a focused sub-screen reached from a tab. Shared so every
 * sub-screen has the same back affordance and the same 40dp target.
 */
export function BackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  return (
    <View style={styles.stepHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={styles.backButton}
      >
        <Chevron direction="back" color={tokens.text.primary} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.stepText}>
        {label}
      </Text>
      <View style={styles.backSpacer} />
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
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
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
      <View style={styles.settingTrail}>
        <Text style={[styles.settingValue, destructive && styles.destructive]}>{value}</Text>
        {onPress ? (
          <Chevron
            direction="forward"
            size={16}
            color={destructive ? tokens.status.error : tokens.text.secondary}
          />
        ) : null}
      </View>
    </Pressable>
  );
}
