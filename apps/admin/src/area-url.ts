import { permittedAreas, type AreaKey } from './areas.js';

const PARAM = 'area';

/**
 * The area a link asks for, if this account may open it. An unknown or
 * forbidden value is ignored rather than honoured: the address bar must never
 * be a way past the role gate (the server still enforces it either way).
 */
export const areaFromSearch = (search: string, roles: readonly string[]): AreaKey | undefined => {
  const wanted = new URLSearchParams(search).get(PARAM);
  return permittedAreas(roles).find((area) => area.key === wanted)?.key;
};

/** The query string for an area, keeping any other parameters. */
export const searchForArea = (search: string, area: AreaKey): string => {
  const params = new URLSearchParams(search);
  params.set(PARAM, area);
  return `?${params.toString()}`;
};
