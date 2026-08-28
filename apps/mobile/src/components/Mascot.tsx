import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { mascotPresentation, type MascotAccessibility, type MascotVariant } from '../mascot';

/**
 * A static, tokenized rendering of the app-owned Loop geometry. The SVG source
 * and state-scoped exports live in assets/mascot; this native primitive avoids
 * animation and works without a platform SVG runtime dependency.
 */
export function LoopMascot({
  variant,
  accessibility,
  size = 76
}: {
  variant: MascotVariant;
  accessibility: MascotAccessibility;
  size?: number;
}) {
  const { tokens, reduceMotion } = useAppTheme();
  const presentation = mascotPresentation(variant, accessibility, reduceMotion);
  const styles = useMemo(() => createStyles(tokens, size), [tokens, size]);
  return (
    <View
      accessible={presentation.accessible}
      accessibilityRole={presentation.accessible ? 'image' : undefined}
      accessibilityLabel={presentation.accessibilityLabel}
      style={styles.guide}
    >
      <View style={styles.pointer} />
      <View style={styles.body} />
      <View style={styles.orbit} />
      <View style={[styles.eye, styles.leftEye]} />
      <View style={[styles.eye, styles.rightEye]} />
      <View style={styles.beaconHalo} />
      <View style={styles.beacon} />
    </View>
  );
}

const createStyles = (tokens: ReturnType<typeof useAppTheme>['tokens'], size: number) =>
  StyleSheet.create({
    guide: { height: size, position: 'relative', width: size },
    pointer: {
      backgroundColor: tokens.mascot.pointer,
      height: size * 0.24,
      left: size * 0.41,
      position: 'absolute',
      top: 0,
      transform: [{ rotate: '45deg' }],
      width: size * 0.18
    },
    body: {
      backgroundColor: tokens.mascot.body,
      borderColor: tokens.mascot.outline,
      borderRadius: size * 0.42,
      borderWidth: 2,
      bottom: size * 0.12,
      left: size * 0.12,
      position: 'absolute',
      right: size * 0.12,
      top: size * 0.21
    },
    orbit: {
      borderColor: tokens.mascot.orbit,
      borderRadius: size / 2,
      borderTopColor: 'transparent',
      borderWidth: 3,
      height: size * 0.24,
      left: size * 0.02,
      position: 'absolute',
      right: size * 0.02,
      top: size * 0.4,
      transform: [{ rotate: '-12deg' }]
    },
    eye: {
      backgroundColor: tokens.mascot.eye,
      borderRadius: size * 0.05,
      height: size * 0.1,
      position: 'absolute',
      top: size * 0.36,
      width: size * 0.08
    },
    leftEye: { left: size * 0.36 },
    rightEye: { right: size * 0.34 },
    beaconHalo: {
      backgroundColor: tokens.mascot.beacon,
      borderRadius: size * 0.085,
      height: size * 0.17,
      opacity: 0.22,
      position: 'absolute',
      right: size * 0.02,
      top: size * 0.37,
      width: size * 0.17
    },
    beacon: {
      backgroundColor: tokens.mascot.beacon,
      borderRadius: size * 0.045,
      height: size * 0.09,
      position: 'absolute',
      right: size * 0.06,
      top: size * 0.41,
      width: size * 0.09
    }
  });
