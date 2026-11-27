import Svg, { Path } from 'react-native-svg';

export function TurfrMark({ color }: { color: string }) {
  return (
    <Svg width={25} height={24} viewBox="0 0 25 24" accessible={false}>
      <Path d="M1 14l4-4h6l4 4v5l-4 4H5l-4-4zm10-10 4-4h6l4 4v5l-4 4h-6l-4-4z" fill={color} />
    </Svg>
  );
}
