import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Club, ClubMember, ClubRelaySummary, ClubRole } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client.js';

const ME = '00000000-0000-4000-8000-00000000000a';
const RAVI = '00000000-0000-4000-8000-00000000000b';
const CLUB = '00000000-0000-4000-8000-0000000000c1';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles },
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View')
  };
});
vi.mock('../components/styles', () => ({
  useAppStyles: () => new Proxy({}, { get: () => ({}) })
}));
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: { text: { primary: '#111', secondary: '#555', inverse: '#fff' } }
  })
}));

const { ClubsScreen } = await import('./ClubsScreen.js');

const club = (overrides: Partial<Club> = {}): Club => ({
  id: CLUB,
  name: 'Morning Movers',
  role: 'member',
  memberCount: 3,
  inviteCode: 'ABCDEFGHJK',
  ...overrides
});

const member = (accountId: string, role: ClubRole, displayName: string): ClubMember => ({
  profile: {
    id: accountId,
    displayName,
    cosmetic: { avatarKey: 'loop-1' },
    activityVisibility: 'private'
  },
  role,
  joinedAt: '2026-09-01T10:00:00.000Z'
});

const relay = (overrides: Partial<ClubRelaySummary> = {}): ClubRelaySummary => ({
  id: 'relay-1',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-07',
  targetUnits: 600,
  totalUnits: 450,
  myUnits: 75,
  contributorCount: 3,
  progressPercent: 75,
  goalMet: false,
  current: true,
  ruleVersion: 1,
  ...overrides
});

const stubApi = (
  overrides: {
    clubs?: Club[];
    members?: ClubMember[];
    relays?: ClubRelaySummary[];
    join?: () => Promise<Club>;
    create?: () => Promise<Club>;
    leave?: () => Promise<void>;
    setTarget?: () => Promise<ClubRelaySummary>;
  } = {}
) =>
  ({
    listClubs: vi.fn(async () => overrides.clubs ?? []),
    listClubMembers: vi.fn(async () => overrides.members ?? []),
    listClubRelays: vi.fn(async () => overrides.relays ?? []),
    setClubRelayTarget: vi.fn(overrides.setTarget ?? (async () => relay())),
    joinClub: vi.fn(overrides.join ?? (async () => club())),
    createClub: vi.fn(overrides.create ?? (async () => club({ role: 'owner', memberCount: 1 }))),
    leaveClub: vi.fn(overrides.leave ?? (async () => undefined)),
    removeClubMember: vi.fn(async () => undefined),
    setClubMemberRole: vi.fn(async () => member(RAVI, 'admin', 'Ravi')),
    archiveClub: vi.fn(async () => club({ archivedAt: '2026-09-04T10:00:00.000Z' }))
  }) as unknown as MobileApiClient & Record<string, ReturnType<typeof vi.fn>>;

const render = async (api: MobileApiClient): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ClubsScreen api={api} accountId={ME} onSessionExpired={() => undefined} />);
  });
  await act(async () => undefined);
  return renderer;
};

const text = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('Text' as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');

const byLabel = (renderer: ReactTestRenderer, predicate: (label: string) => boolean) =>
  renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      predicate(String((node.props as Record<string, unknown>)['accessibilityLabel'] ?? ''))
  );

const press = async (renderer: ReactTestRenderer, label: string) => {
  const control = byLabel(renderer, (found) => found === label)[0]!;
  await act(async () => (control.props as { onPress: () => void }).onPress());
};

const openClub = async (renderer: ReactTestRenderer) => {
  const row = byLabel(renderer, (label) => label.includes('Open club'))[0]!;
  await act(async () => (row.props as { onPress: () => void }).onPress());
  await act(async () => undefined);
};

describe('Clubs tab', () => {
  it('says clubs are private and offers no directory to browse', async () => {
    const renderer = await render(stubApi());
    const rendered = text(renderer);

    expect(rendered).toContain('There is no directory and no search');
    expect(rendered).not.toMatch(/nearby|discover|popular|browse/i);
  });

  it('explains an empty state instead of showing a placeholder future', async () => {
    const renderer = await render(stubApi());
    expect(text(renderer)).toContain('You are not in a club yet');
    expect(text(renderer)).not.toContain('coming later');
  });

  it('joins with a code and reports which club was joined', async () => {
    const api = stubApi();
    const renderer = await render(api);
    const field = renderer.root.findAllByType('TextInput' as React.ElementType)[0]!;

    await act(async () =>
      (field.props as { onChangeText: (v: string) => void }).onChangeText('abcdefghjk')
    );
    await press(renderer, 'Join club');

    expect(api.joinClub).toHaveBeenCalledWith('abcdefghjk');
    expect(text(renderer)).toContain('You joined Morning Movers.');
  });

  it('treats an unknown code and an archived club the same way', async () => {
    const api = stubApi({
      join: async () => {
        throw new ApiFailure(404, 'Club not found');
      }
    });
    const renderer = await render(api);
    const field = renderer.root.findAllByType('TextInput' as React.ElementType)[0]!;

    await act(async () =>
      (field.props as { onChangeText: (v: string) => void }).onChangeText('ZZZZZZZZZZ')
    );
    await press(renderer, 'Join club');

    expect(text(renderer)).toContain('No club matches that code');
  });

  it('creates a club and shows the code the server generated', async () => {
    const api = stubApi();
    const renderer = await render(api);
    const nameField = renderer.root.findAllByType('TextInput' as React.ElementType)[1]!;

    await act(async () =>
      (nameField.props as { onChangeText: (v: string) => void }).onChangeText('  Morning  Movers ')
    );
    await press(renderer, 'Create club');

    expect(api.createClub).toHaveBeenCalledWith('Morning Movers');
    expect(text(renderer)).toContain('Share the code ABCDEFGHJK');
  });

  it('rejects an empty club name without calling the server', async () => {
    const api = stubApi();
    const renderer = await render(api);

    await press(renderer, 'Create club');

    expect(api.createClub).not.toHaveBeenCalled();
    expect(text(renderer)).toContain('Give the club a name');
  });

  it('lists the clubs the account is in with role and size', async () => {
    const renderer = await render(stubApi({ clubs: [club({ role: 'admin' })] }));
    expect(text(renderer)).toContain('Morning Movers');
    expect(text(renderer)).toContain('Admin');
    expect(text(renderer)).toContain('3 members');
  });
});

describe('Club detail', () => {
  it('offers an owner promotion and removal, and neither on their own row', async () => {
    const api = stubApi({
      clubs: [club({ role: 'owner' })],
      members: [member(ME, 'owner', 'Maya'), member(RAVI, 'member', 'Ravi')]
    });
    const renderer = await render(api);
    await openClub(renderer);

    expect(byLabel(renderer, (label) => label === 'Make Ravi an admin')).toHaveLength(1);
    expect(byLabel(renderer, (label) => label === 'Remove Ravi from the club')).toHaveLength(1);
    // The owner's own row is still announced, it just carries no action.
    expect(byLabel(renderer, (label) => /^(Make|Remove) Maya/.test(label))).toHaveLength(0);
    expect(byLabel(renderer, (label) => label === 'Maya. Owner. This is you.')).toHaveLength(1);
  });

  it('offers a plain member no moderation controls at all', async () => {
    const api = stubApi({
      clubs: [club({ role: 'member' })],
      members: [member(ME, 'member', 'Maya'), member(RAVI, 'owner', 'Ravi')]
    });
    const renderer = await render(api);
    await openClub(renderer);

    expect(byLabel(renderer, (label) => label.startsWith('Make '))).toHaveLength(0);
    expect(byLabel(renderer, (label) => label.startsWith('Remove '))).toHaveLength(0);
    expect(byLabel(renderer, (label) => label === 'Archive this club')).toHaveLength(0);
  });

  it('promotes a member through the server', async () => {
    const api = stubApi({
      clubs: [club({ role: 'owner' })],
      members: [member(RAVI, 'member', 'Ravi')]
    });
    const renderer = await render(api);
    await openClub(renderer);
    await press(renderer, 'Make Ravi an admin');

    expect(api.setClubMemberRole).toHaveBeenCalledWith(CLUB, RAVI, 'admin');
    expect(text(renderer)).toContain('Ravi is now an admin.');
  });

  it('warns what removal does before it is pressed', async () => {
    const api = stubApi({
      clubs: [club({ role: 'admin' })],
      members: [member(RAVI, 'member', 'Ravi')]
    });
    const renderer = await render(api);
    await openClub(renderer);

    const remove = byLabel(renderer, (label) => label === 'Remove Ravi from the club')[0]!;
    expect(String(remove.props.accessibilityHint)).toContain('rejoin with the invite code');
  });

  it('explains why an owner of a populated club cannot leave', async () => {
    const api = stubApi({ clubs: [club({ role: 'owner', memberCount: 3 })] });
    const renderer = await render(api);
    await openClub(renderer);

    expect(byLabel(renderer, (label) => label === 'Leave this club')).toHaveLength(0);
    expect(text(renderer)).toContain('archive it before leaving');
  });

  it('requires a second press to archive, having said what it costs', async () => {
    const api = stubApi({ clubs: [club({ role: 'owner', memberCount: 3 })] });
    const renderer = await render(api);
    await openClub(renderer);

    await press(renderer, 'Archive this club');
    expect(api.archiveClub).not.toHaveBeenCalled();
    expect(text(renderer)).toContain('ends access for every member, including you');

    await press(renderer, 'Confirm archiving this club');
    expect(api.archiveClub).toHaveBeenCalledWith(CLUB);
  });

  it('shows the invite code and says it works like a key', async () => {
    const api = stubApi({ clubs: [club({ role: 'owner' })] });
    const renderer = await render(api);
    await openClub(renderer);

    expect(text(renderer)).toContain('ABCDEFGHJK');
    expect(text(renderer)).toContain('treat it');
    // Spelled out so a screen reader does not run the characters together.
    expect(byLabel(renderer, (label) => label === 'Invite code A B C D E F G H J K')).toHaveLength(
      1
    );
  });

  it('explains that a blocked member is absent while the count is not', async () => {
    const api = stubApi({
      clubs: [club({ role: 'member' })],
      members: [member(ME, 'member', 'Maya')]
    });
    const renderer = await render(api);
    await openClub(renderer);

    expect(text(renderer)).toContain('count above still counts everyone');
  });

  it('says club boards are not built yet rather than showing an empty one', async () => {
    const api = stubApi({ clubs: [club()] });
    const renderer = await render(api);
    await openClub(renderer);

    expect(text(renderer)).toContain('not built yet');
    expect(text(renderer)).toContain('aggregate totals');
  });
});

describe('Club relay', () => {
  it('shows the club total against the target and the reader own share', async () => {
    const api = stubApi({ clubs: [club()], relays: [relay()] });
    const renderer = await render(api);
    await openClub(renderer);

    expect(text(renderer)).toContain('450 minutes of 600');
    expect(text(renderer)).toContain('3 members contributed');
    expect(text(renderer)).toContain('You added 75 minutes');
    expect(text(renderer)).toContain('In progress');
  });

  it('never shows another member contribution, only counts and totals', async () => {
    const api = stubApi({
      clubs: [club()],
      members: [member(ME, 'member', 'Maya'), member(RAVI, 'owner', 'Ravi')],
      relays: [relay()]
    });
    const renderer = await render(api);
    await openClub(renderer);

    const rendered = text(renderer);
    // Ravi appears as a member, but no figure is ever attached to their name.
    expect(rendered).toContain('Ravi');
    expect(rendered).not.toMatch(/Ravi[^|]*\d+ minutes/);
  });

  it('announces the relay as one unit with a percentage a screen reader can use', async () => {
    const api = stubApi({ clubs: [club()], relays: [relay()] });
    const renderer = await render(api);
    await openClub(renderer);

    expect(
      byLabel(renderer, (label) => label.startsWith('This week. 75 percent of the club target.'))
    ).toHaveLength(1);
  });

  it('reports a met target without saying how far past it the club went', async () => {
    const api = stubApi({
      clubs: [club()],
      relays: [relay({ totalUnits: 1800, progressPercent: 100, goalMet: true })]
    });
    const renderer = await render(api);
    await openClub(renderer);

    expect(text(renderer)).toContain('Target met');
    expect(text(renderer)).not.toContain('300%');
  });

  it('explains that a relay is cooperative and pace-free where it is shown', async () => {
    const api = stubApi({ clubs: [club()], relays: [relay()] });
    const renderer = await render(api);
    await openClub(renderer);

    const rendered = text(renderer);
    expect(rendered).toContain('takes several people rather than one');
    expect(rendered).toContain('only the club total');
  });

  it('offers the target field to an admin and not to a member', async () => {
    const asAdmin = await render(stubApi({ clubs: [club({ role: 'admin' })], relays: [relay()] }));
    await openClub(asAdmin);
    expect(byLabel(asAdmin, (label) => label === 'Weekly relay target in minutes')).toHaveLength(1);

    const asMember = await render(
      stubApi({ clubs: [club({ role: 'member' })], relays: [relay()] })
    );
    await openClub(asMember);
    expect(byLabel(asMember, (label) => label === 'Weekly relay target in minutes')).toHaveLength(
      0
    );
    expect(text(asMember)).not.toContain('Save weekly target');
  });

  it('saves a target for the open week only', async () => {
    const api = stubApi({ clubs: [club({ role: 'owner' })], relays: [] });
    const renderer = await render(api);
    await openClub(renderer);

    const field = renderer.root
      .findAllByType('TextInput' as React.ElementType)
      .find((node) => node.props.accessibilityLabel === 'Weekly relay target in minutes')!;
    await act(async () =>
      (field.props as { onChangeText: (v: string) => void }).onChangeText('600')
    );
    await press(renderer, 'Save weekly relay target');

    expect(api.setClubRelayTarget).toHaveBeenCalledWith(CLUB, 600);
    expect(text(renderer)).toContain('This week target is 600 minutes.');
  });

  it('rejects a target outside the published bounds without calling the server', async () => {
    const api = stubApi({ clubs: [club({ role: 'owner' })], relays: [] });
    const renderer = await render(api);
    await openClub(renderer);

    const field = renderer.root
      .findAllByType('TextInput' as React.ElementType)
      .find((node) => node.props.accessibilityLabel === 'Weekly relay target in minutes')!;
    await act(async () =>
      (field.props as { onChangeText: (v: string) => void }).onChangeText('10')
    );
    await press(renderer, 'Save weekly relay target');

    expect(api.setClubRelayTarget).not.toHaveBeenCalled();
    expect(text(renderer)).toContain('between 60 and 20000 minutes');
  });

  it('says no target is set rather than showing a zero relay', async () => {
    const api = stubApi({ clubs: [club({ role: 'member' })], relays: [] });
    const renderer = await render(api);
    await openClub(renderer);

    expect(text(renderer)).toContain('No relay target has been set yet');
    expect(text(renderer)).toContain('An owner or admin can set one');
  });
});
