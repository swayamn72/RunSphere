import { Image, type ImageSourcePropType } from 'react-native';
import firstSteps from '../../assets/medallions/first-steps.png';
import levelThree from '../../assets/medallions/level-three.png';
import sevenHourStride from '../../assets/medallions/seven-hour-stride.png';
import threeDayRhythm from '../../assets/medallions/three-day-rhythm.png';
import turfPoints from '../../assets/medallions/turf-points.png';
import { Text } from './Text';
import { useAppStyles } from './styles';

const achievementArt: Readonly<Partial<Record<string, ImageSourcePropType>>> = {
  first_steps: firstSteps,
  three_day_rhythm: threeDayRhythm,
  seven_hour_stride: sevenHourStride,
  level_three: levelThree
};

export function TurfPointsMark({ size }: { size: number }) {
  return <Image accessible={false} source={turfPoints} style={{ width: size, height: size }} />;
}

export function AchievementArt({ achievementKey }: { achievementKey: string }) {
  const styles = useAppStyles();
  const source = Object.hasOwn(achievementArt, achievementKey)
    ? achievementArt[achievementKey]
    : undefined;
  return source ? (
    <Image accessible={false} source={source} style={styles.achievementArt} />
  ) : (
    <Text accessible={false} style={styles.tierBadgeGlyph}>
      ★
    </Text>
  );
}
