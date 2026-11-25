import { themePreferences, type ThemePreference } from '../theme.js';
import { Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuSeparator } from './Menu.js';
import { THEME_LABEL, useThemePreference } from './ThemeSwitch.js';

/**
 * The signed-in account at the foot of the sidebar: who is signed in, the
 * appearance choice, and Sign out. One place for the things that belong to the
 * person rather than to the page they are on.
 */
export function AccountMenu({
  roles,
  onSignOut
}: {
  /** Role names shown under "Signed in as". Empty for an account with no staff role. */
  roles: readonly string[];
  onSignOut: () => void;
}) {
  const [preference, choose] = useThemePreference();
  return (
    <Menu
      label="Account"
      align="start"
      trigger={
        <>
          <span className="rs-avatar" aria-hidden>
            S
          </span>
          <span className="rs-account__text">
            <span className="rs-account__title">Staff account</span>
            <span className="rs-account__sub">{roles.length ? roles.join(', ') : 'Signed in'}</span>
          </span>
        </>
      }
    >
      <MenuLabel>Appearance</MenuLabel>
      <MenuRadioGroup<ThemePreference>
        value={preference}
        onChange={choose}
        options={themePreferences.map((value) => ({ value, label: THEME_LABEL[value] }))}
      />
      <MenuSeparator />
      <MenuItem onSelect={onSignOut}>Sign out</MenuItem>
    </Menu>
  );
}
