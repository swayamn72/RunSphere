import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { darkTokens, lightTokens } from '@runsphere/ui';

const setColorScheme = vi.fn();
let systemScheme: 'light' | 'dark' | null = 'dark';
let fontsLoad: () => Promise<void> = async () => undefined;

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    View: native('View'),
    Text: native('Text'),
    useColorScheme: () => systemScheme,
    Appearance: { setColorScheme: (scheme: unknown) => setColorScheme(scheme) },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove: () => undefined })
    }
  };
});
vi.mock('expo-status-bar', async () => {
  const React = await import('react');
  return {
    StatusBar: (props: Record<string, unknown>) => React.createElement('StatusBar', props)
  };
});
vi.mock('expo-font', () => ({ loadAsync: () => fontsLoad() }));

const { ThemeProvider, ForceTheme, useAppTheme } = await import('./theme.js');
const { AppText } = await import('../components/AppText.js');

type Theme = ReturnType<typeof useAppTheme>;
let seen: Theme[] = [];
function Probe() {
  seen.push(useAppTheme());
  return <AppText variant="metric">12.4</AppText>;
}
const latest = () => seen[seen.length - 1]!;

const store = (initial: 'light' | 'dark' | 'system' | 'broken') => ({
  load: vi.fn(async () => {
    if (initial === 'broken') throw new Error('unreadable');
    return initial;
  }),
  save: vi.fn(async () => undefined)
});

const byName = (renderer: ReturnType<typeof create>, name: string) =>
  renderer.root.findAll((node) => (node.type as unknown) === name);

const mount = async (element: React.ReactElement) => {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
};

beforeEach(() => {
  seen = [];
  systemScheme = 'dark';
  fontsLoad = async () => undefined;
  setColorScheme.mockClear();
});

describe('theme provider', () => {
  it('is light for a first launch even on a dark phone, and says so to the platform', async () => {
    await mount(
      <ThemeProvider store={store('light')}>
        <Probe />
      </ThemeProvider>
    );
    expect(latest().colorScheme).toBe('light');
    expect(latest().tokens).toBe(lightTokens);
    expect(setColorScheme).toHaveBeenLastCalledWith('light');
  });

  it('draws nothing but a splash-coloured frame until the saved choice is read', async () => {
    let release!: (value: 'dark') => void;
    const slow = {
      load: () => new Promise<'dark'>((resolve) => (release = resolve)),
      save: async () => undefined
    };
    const renderer = await mount(
      <ThemeProvider store={slow}>
        <Probe />
      </ThemeProvider>
    );
    expect(seen).toHaveLength(0);
    expect(byName(renderer, 'View')[0]!.props.style).toMatchObject({
      backgroundColor: darkTokens.background.canvas
    });
    await act(async () => release('dark'));
    expect(latest().colorScheme).toBe('dark');
    expect(byName(renderer, 'View')).toHaveLength(0);
  });

  it('follows the phone for "Match phone" and hands control back to it', async () => {
    await mount(
      <ThemeProvider store={store('system')}>
        <Probe />
      </ThemeProvider>
    );
    expect(latest().colorScheme).toBe('dark');
    expect(setColorScheme).toHaveBeenLastCalledWith('unspecified');
  });

  it('applies a new choice at once and saves it', async () => {
    const saved = store('light');
    await mount(
      <ThemeProvider store={saved}>
        <Probe />
      </ThemeProvider>
    );
    await act(async () => latest().setPreference('dark'));
    expect(latest().colorScheme).toBe('dark');
    expect(saved.save).toHaveBeenCalledWith('dark');
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');
  });

  it('still opens, in light, when the saved choice cannot be read', async () => {
    await mount(
      <ThemeProvider store={store('broken')}>
        <Probe />
      </ThemeProvider>
    );
    expect(latest().colorScheme).toBe('light');
  });

  it('draws in the platform font when Inter will not load, and in Inter when it does', async () => {
    fontsLoad = async () => {
      throw new Error('no font');
    };
    await mount(
      <ThemeProvider store={store('light')}>
        <Probe />
      </ThemeProvider>
    );
    expect(latest().fontsReady).toBe(false);

    seen = [];
    fontsLoad = async () => undefined;
    const renderer = await mount(
      <ThemeProvider store={store('light')}>
        <Probe />
      </ThemeProvider>
    );
    expect(latest().fontsReady).toBe(true);
    const text = byName(renderer, 'Text')[0]!;
    expect((text.props.style as Record<string, unknown>[])[0]).toMatchObject({
      fontFamily: 'Inter_600SemiBold',
      fontVariant: ['tabular-nums']
    });
  });
});

describe('force theme', () => {
  it('keeps its children dark in a light app, and light again when released', async () => {
    const tree = (scheme?: 'dark') => (
      <ThemeProvider store={store('light')}>
        <ForceTheme {...(scheme ? { scheme } : {})}>
          <Probe />
        </ForceTheme>
      </ThemeProvider>
    );
    const renderer = await mount(tree('dark'));
    expect(latest().colorScheme).toBe('dark');
    expect(latest().tokens).toBe(darkTokens);
    expect(byName(renderer, 'StatusBar')[0]!.props.style).toBe('light');

    await act(async () => renderer.update(tree()));
    expect(latest().colorScheme).toBe('light');
    expect(byName(renderer, 'StatusBar')[0]!.props.style).toBe('dark');
  });

  it('keeps the preference intact for the rest of the app', async () => {
    await mount(
      <ThemeProvider store={store('light')}>
        <ForceTheme scheme="dark">
          <Probe />
        </ForceTheme>
      </ThemeProvider>
    );
    expect(latest().preference).toBe('light');
  });
});
