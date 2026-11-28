import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { lucideIcons, type IconName } from './lucide-icons';

const shapes = { path: Path, circle: Circle, rect: Rect, line: Line } as const;

/**
 * An open-source Lucide icon (`assets/icons/lucide`). Decorative: the control or
 * row beside it carries the words, so screen readers skip the drawing.
 */
export function Icon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      {lucideIcons[name].map((shape, index) => {
        const Shape = shapes[shape.tag];
        return <Shape key={index} {...shape.attributes} />;
      })}
    </Svg>
  );
}
