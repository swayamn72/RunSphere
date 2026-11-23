import Svg, { Path } from 'react-native-svg';

const icons = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15',
  run: 'M8 5v14l11-7z',
  runner: 'M16 4a1 1 0 1 0 2 0 1 1 0 0 0-2 0zm-8 7 3-3h4l3 4 3-1m-6-3-4 6 4 3-2 5m-2-8-4 5H3',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0zm-4 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  calendar:
    'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm0 3h16M8 3v4m8-4v4',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v5m-4 1h8',
  route:
    'M8 18h6a3 3 0 0 0 3-3v-2M8 17c0 2-3 5-3 5s-3-3-3-5a3 3 0 0 1 6 0zm12-10c0 2-3 5-3 5s-3-3-3-5a3 3 0 0 1 6 0z',
  chevron: 'm9 6 6 6-6 6',
  loop: 'M8 7h9a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h9M8 4 5 7l3 3m8 6 3 3-3 3',
  flag: 'M5 21V4m0 1c4-3 8 3 14 0v10c-6 3-10-3-14 0',
  timer: 'M9 2h6m3 3 2 2m0 6a8 8 0 1 1-16 0 8 8 0 1 1 16 0zm-8 0V9',
  social:
    'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-4M13.5 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0zm3-4a4 4 0 0 1 0 8',
  profile: 'M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2M16 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0z',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0zm-2 4 6 6',
  close: 'm6 6 12 12M18 6 6 18',
  layers: 'm12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5',
  locate: 'M12 2v4m0 12v4M2 12h4m12 0h4m-4 0a6 6 0 1 1-12 0 6 6 0 1 1 12 0z',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0zm-9-1v5m0-8h.01',
  bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zm5 3a2 2 0 0 0 4 0',
  settings: 'M4 7h16M4 17h16M9 4v6m6 4v6'
};

export function NavigationIcon({
  name,
  color,
  size = 22
}: {
  name: keyof typeof icons;
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={icons[name]}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
