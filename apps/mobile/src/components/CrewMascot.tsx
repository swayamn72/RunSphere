import { Image, View, type ViewStyle } from 'react-native';
import { crewImageOverrides } from '../crew-assets';
import { crewPresentation, type CrewCharacter } from '../crew';
import type { MascotAccessibility } from '../mascot';
import { useAppTheme } from '../theme/theme';

/**
 * Renders a RunSphere crew mascot (Rho, Mira, Coda, Bram) as a dependency-free
 * vector stand-in. When the matching `crewImageOverrides` entry is provided,
 * a raster image is used instead, keeping the swap to user artwork a one-file
 * change.
 */
export function CrewMascot({
  character,
  size = 76,
  accessibility
}: {
  character: CrewCharacter;
  size?: number;
  accessibility: MascotAccessibility;
}) {
  const { tokens, colorScheme, reduceMotion } = useAppTheme();
  const presentation = crewPresentation(character, accessibility, reduceMotion);
  const override = crewImageOverrides[character];
  const image = override ? (colorScheme === 'dark' ? override.dark : override.light) : undefined;

  if (image) {
    return (
      <Image
        accessible={presentation.accessible}
        accessibilityRole={presentation.accessible ? 'image' : undefined}
        accessibilityLabel={presentation.accessibilityLabel}
        source={image}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  }

  return (
    <View
      accessible={presentation.accessible}
      accessibilityRole={presentation.accessible ? 'image' : undefined}
      accessibilityLabel={presentation.accessibilityLabel}
      style={{ position: 'relative', width: size, height: size }}
    >
      {character === 'rho' && <Rho tokens={tokens.mascot} size={size} />}
      {character === 'mira' && <Mira tokens={tokens.mascot} size={size} />}
      {character === 'coda' && <Coda tokens={tokens.mascot} size={size} />}
      {character === 'bram' && <Bram tokens={tokens.mascot} size={size} />}
    </View>
  );
}

interface MascotTokens {
  readonly body: string;
  readonly outline: string;
  readonly orbit: string;
  readonly pointer: string;
  readonly eye: string;
  readonly beacon: string;
}

function body(
  m: MascotTokens,
  s: number,
  box: { top: number; left: number; right: number; bottom: number; radius: number }
): ViewStyle {
  return {
    position: 'absolute',
    top: box.top,
    left: box.left,
    right: box.right,
    bottom: box.bottom,
    backgroundColor: m.body,
    borderColor: m.outline,
    borderWidth: Math.max(2, s * 0.03),
    borderRadius: box.radius
  };
}

function eye(
  m: MascotTokens,
  s: number,
  top: number,
  side: 'left' | 'right',
  inset: number
): ViewStyle {
  const style: ViewStyle = {
    position: 'absolute',
    top,
    width: s * 0.08,
    height: s * 0.1,
    borderRadius: s * 0.05,
    backgroundColor: m.eye
  };
  if (side === 'left') style.left = inset;
  else style.right = inset;
  return style;
}

function foot(m: MascotTokens, s: number, top: number, left: number, width: number): ViewStyle {
  return {
    position: 'absolute',
    top,
    left,
    width,
    height: s * 0.07,
    borderRadius: s * 0.035,
    backgroundColor: m.outline
  };
}

function pulse(
  m: MascotTokens,
  s: number,
  top: number,
  left: number,
  width: number,
  height: number
): ViewStyle {
  return {
    position: 'absolute',
    top,
    left,
    width,
    height,
    borderRadius: height / 2,
    backgroundColor: m.beacon
  };
}

function Rho({ tokens: m, size: s }: { tokens: MascotTokens; size: number }) {
  return (
    <>
      <View
        style={body(m, s, {
          top: s * 0.3,
          left: s * 0.1,
          right: s * 0.1,
          bottom: s * 0.24,
          radius: s * 0.5
        })}
      />
      <View style={eye(m, s, s * 0.46, 'left', s * 0.33)} />
      <View style={eye(m, s, s * 0.46, 'right', s * 0.33)} />
      <View style={pulse(m, s, s * 0.64, s * 0.3, s * 0.1, s * 0.04)} />
      <View style={pulse(m, s, s * 0.6, s * 0.405, s * 0.04, s * 0.1)} />
      <View style={pulse(m, s, s * 0.64, s * 0.5, s * 0.1, s * 0.04)} />
      <View style={foot(m, s, s * 0.8, s * 0.36, s * 0.13)} />
      <View style={foot(m, s, s * 0.8, s * 0.51, s * 0.13)} />
    </>
  );
}

function Mira({ tokens: m, size: s }: { tokens: MascotTokens; size: number }) {
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: s * 0.47,
          left: s * 0.1,
          width: s * 0.14,
          height: s * 0.28,
          borderRadius: s * 0.07,
          backgroundColor: m.pointer
        }}
      />
      <View
        style={body(m, s, {
          top: s * 0.49,
          left: s * 0.3,
          right: s * 0.3,
          bottom: s * 0.2,
          radius: s * 0.24
        })}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.36,
          left: s * 0.47,
          width: s * 0.06,
          height: s * 0.15,
          backgroundColor: m.outline
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.14,
          left: s * 0.345,
          width: s * 0.31,
          height: s * 0.26,
          borderRadius: s * 0.12,
          backgroundColor: m.body,
          borderColor: m.outline,
          borderWidth: Math.max(2, s * 0.03)
        }}
      />
      <View style={eye(m, s, s * 0.26, 'left', s * 0.4)} />
      <View style={eye(m, s, s * 0.26, 'right', s * 0.38)} />
      <View
        style={{
          position: 'absolute',
          top: s * 0.62,
          right: s * 0.2,
          width: s * 0.14,
          height: s * 0.08,
          borderRadius: s * 0.03,
          backgroundColor: m.body,
          borderColor: m.outline,
          borderWidth: 1
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.16,
          right: s * 0.1,
          width: s * 0.18,
          height: s * 0.18,
          borderRadius: s * 0.09,
          backgroundColor: m.beacon,
          opacity: 0.22
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.2,
          right: s * 0.14,
          width: s * 0.1,
          height: s * 0.1,
          borderRadius: s * 0.05,
          backgroundColor: m.beacon
        }}
      />
    </>
  );
}

function Coda({ tokens: m, size: s }: { tokens: MascotTokens; size: number }) {
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: s * 0.22,
          left: s * 0.45,
          width: s * 0.03,
          height: s * 0.12,
          backgroundColor: m.outline
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.22,
          left: s * 0.52,
          width: s * 0.03,
          height: s * 0.12,
          backgroundColor: m.outline
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.12,
          left: s * 0.42,
          width: s * 0.09,
          height: s * 0.09,
          borderRadius: s * 0.045,
          backgroundColor: m.beacon
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.12,
          left: s * 0.5,
          width: s * 0.09,
          height: s * 0.09,
          borderRadius: s * 0.045,
          backgroundColor: m.beacon
        }}
      />
      <View
        style={body(m, s, {
          top: s * 0.32,
          left: s * 0.12,
          right: s * 0.12,
          bottom: s * 0.26,
          radius: s * 0.5
        })}
      />
      <View style={eye(m, s, s * 0.46, 'left', s * 0.34)} />
      <View style={eye(m, s, s * 0.46, 'right', s * 0.34)} />
      <View
        style={{
          position: 'absolute',
          top: s * 0.6,
          left: s * 0.47,
          width: s * 0.06,
          height: s * 0.06,
          borderRadius: s * 0.03,
          backgroundColor: m.beacon
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.6,
          right: s * 0.08,
          width: s * 0.16,
          height: s * 0.06,
          borderRadius: s * 0.03,
          backgroundColor: m.outline
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.6,
          right: s * 0.05,
          width: s * 0.05,
          height: s * 0.06,
          borderRadius: s * 0.02,
          backgroundColor: m.beacon
        }}
      />
    </>
  );
}

function Bram({ tokens: m, size: s }: { tokens: MascotTokens; size: number }) {
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: s * 0.08,
          left: s * 0.41,
          width: s * 0.18,
          height: s * 0.18,
          backgroundColor: m.pointer,
          transform: [{ rotate: '45deg' }]
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.28,
          left: s * 0.16,
          width: s * 0.12,
          height: s * 0.12,
          backgroundColor: m.outline,
          transform: [{ rotate: '45deg' }]
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: s * 0.28,
          right: s * 0.16,
          width: s * 0.12,
          height: s * 0.12,
          backgroundColor: m.outline,
          transform: [{ rotate: '45deg' }]
        }}
      />
      <View
        style={body(m, s, {
          top: s * 0.34,
          left: s * 0.08,
          right: s * 0.08,
          bottom: s * 0.24,
          radius: s * 0.22
        })}
      />
      <View style={eye(m, s, s * 0.46, 'left', s * 0.3)} />
      <View style={eye(m, s, s * 0.46, 'right', s * 0.3)} />
      <View
        style={{
          position: 'absolute',
          top: s * 0.56,
          left: s * 0.44,
          width: s * 0.12,
          height: s * 0.12,
          backgroundColor: m.beacon,
          transform: [{ rotate: '45deg' }]
        }}
      />
      <View style={foot(m, s, s * 0.79, s * 0.26, s * 0.2)} />
      <View style={foot(m, s, s * 0.79, s * 0.54, s * 0.2)} />
    </>
  );
}
