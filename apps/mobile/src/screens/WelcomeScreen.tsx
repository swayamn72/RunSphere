import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { darkTokens, radius, space, type SemanticTokens } from '@runsphere/ui';
import { Icon } from '../components/Icon';
import { PrimaryButton } from '../components/primitives';
import { Text } from '../components/Text';
import { TurfrMark } from '../components/TurfrMark';
import { useAppTheme } from '../theme/theme';
import type { LegalLink } from './legal-model';
import {
  TURF_ART,
  TURF_LOOP,
  TURF_LOOP_START,
  TURF_STREETS,
  WELCOME_COPY,
  WELCOME_FEATURES,
  turfHexCells
} from './welcome-model';

/**
 * The first screen: who this is, what a run does here, and the two ways in. The
 * actions sit at the bottom, in the thumb zone; the illustration gives up height
 * first on a short phone, and the page scrolls at large text sizes.
 */
export function WelcomeScreen({
  onGetStarted,
  onSignIn,
  legal,
  onOpenLegal
}: {
  onGetStarted: () => void;
  onSignIn: () => void;
  legal: readonly LegalLink[];
  onOpenLegal: (url: string) => void;
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.root}>
      <View style={styles.brandRow}>
        <TurfrMark color={tokens.text.accent} />
        <Text maxFontSizeMultiplier={1.4} style={styles.brand}>
          {WELCOME_COPY.brand}
        </Text>
      </View>

      <TurfArt />

      <Text accessibilityRole="header" style={styles.headline}>
        {WELCOME_COPY.headline}
      </Text>

      <View style={styles.features}>
        {WELCOME_FEATURES.map((feature) => (
          <View key={feature.icon} accessible style={styles.feature}>
            <View style={styles.featureIcon}>
              <Icon name={feature.icon} color={tokens.text.primary} />
            </View>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureLine}>{feature.line}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <PrimaryButton label={WELCOME_COPY.primary} onPress={onGetStarted} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={WELCOME_COPY.secondary}
          onPress={onSignIn}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>{WELCOME_COPY.secondary}</Text>
        </Pressable>
        {legal.length > 0 && (
          <View style={styles.legal}>
            {legal.map((link) => (
              <Pressable
                key={link.page}
                accessibilityRole="link"
                accessibilityLabel={link.label}
                hitSlop={8}
                onPress={() => onOpenLegal(link.url)}
              >
                <Text style={styles.legalText}>{link.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/** Night in both themes, like the map it stands for. */
function TurfArt() {
  const night = darkTokens;
  const cells = useMemo(() => turfHexCells(), []);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // A hairline so the night panel keeps its edge on the dark canvas too.
      style={[artStyles.frame, { borderColor: night.border.subtle }]}
    >
      {/* Out of the flow, so the drawing's own size never pushes the actions down. */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox={`0 0 ${TURF_ART.width} ${TURF_ART.height}`}
        preserveAspectRatio="xMidYMid slice"
        accessible={false}
      >
        <Rect width={TURF_ART.width} height={TURF_ART.height} fill={night.background.surface} />
        <Path
          d={TURF_STREETS}
          fill="none"
          stroke={night.border.strong}
          strokeOpacity={0.35}
          strokeWidth={5}
        />
        {cells.map((cell) => (
          <Path
            key={cell.key}
            d={cell.path}
            fill={cell.claimed ? night.zone.ownedFill : 'none'}
            stroke={cell.claimed ? night.brand.lime : night.border.subtle}
            strokeWidth={cell.claimed ? 1.5 : 1}
          />
        ))}
        <Path
          d={TURF_LOOP}
          fill="none"
          stroke={night.brand.lime}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <Circle
          cx={TURF_LOOP_START.x}
          cy={TURF_LOOP_START.y}
          r={8}
          fill={night.brand.lime}
          stroke={night.background.canvas}
          strokeWidth={4}
        />
      </Svg>
    </View>
  );
}

const artStyles = StyleSheet.create({
  frame: {
    borderRadius: radius.sheet,
    borderWidth: 1,
    // A small basis that grows: inside a scroll view nothing shrinks, so the
    // art starts short and takes only the height the words and actions leave.
    flexBasis: 140,
    // Large text leaves no spare height; the art keeps this much and the page scrolls.
    minHeight: 140,
    flexGrow: 1,
    marginTop: space.lg,
    maxHeight: 340,
    overflow: 'hidden'
  }
});

const createStyles = (t: SemanticTokens) =>
  StyleSheet.create({
    root: { flexGrow: 1 },
    brandRow: { alignItems: 'center', flexDirection: 'row', gap: space.sm },
    brand: { color: t.text.primary, fontSize: 20, fontWeight: '700', letterSpacing: 1 },
    headline: {
      color: t.text.primary,
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.4,
      lineHeight: 34,
      marginTop: space.xl
    },
    features: { gap: space.md, marginTop: space.lg },
    feature: { alignItems: 'flex-start', flexDirection: 'row', gap: space.md },
    featureIcon: {
      alignItems: 'center',
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: radius.control,
      borderWidth: 1,
      height: 44,
      justifyContent: 'center',
      width: 44
    },
    featureCopy: { flex: 1 },
    featureTitle: { color: t.text.primary, fontSize: 15, fontWeight: '600', lineHeight: 22 },
    featureLine: { color: t.text.secondary, fontSize: 14, lineHeight: 20 },
    actions: { marginTop: 'auto', paddingTop: space.xl },
    secondary: {
      alignItems: 'center',
      borderColor: t.border.strong,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: 'center',
      marginTop: space.md,
      minHeight: 54,
      paddingHorizontal: space.xl,
      paddingVertical: space.md
    },
    secondaryText: { color: t.text.primary, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    pressed: { opacity: 0.7 },
    legal: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: space.lg,
      marginTop: space.lg
    },
    legalText: { color: t.text.secondary, fontSize: 12, textDecorationLine: 'underline' }
  });
