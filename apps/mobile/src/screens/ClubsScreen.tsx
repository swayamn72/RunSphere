import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Club, ClubMember, ClubRelaySummary } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { BackHeader, PrimaryButton, SettingsGroup } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import {
  ARCHIVE_CONSEQUENCE,
  RELAY_EXPLANATION,
  canSetRelayTarget,
  clubActions,
  clubListState,
  clubMemberRows,
  clubRows,
  clubsErrorState,
  clubsStatusMessage,
  createFailureNotice,
  joinFailureNotice,
  leaveFailureNotice,
  moderationFailureNotice,
  relayFailureNotice,
  relayRows,
  validateClubName,
  validateRelayTarget,
  type ClubsRemoteState
} from './clubs-model';

/**
 * The Clubs tab (Phase 3, milestone 3.1). It replaces the truthful
 * "coming later" placeholder now that clubs actually exist server-side.
 *
 * A club is private and invite-code-only, so there is nothing to browse: the
 * tab shows the clubs you are in, a field for a code somebody gave you, and a
 * way to start one. Every moderation control is gated by the same predicate in
 * `@runsphere/domain` the route enforces, so nothing is offered that the
 * server will refuse.
 *
 * Relays and club boards are not here: no relay contribution is recorded
 * server-side yet, and a progress bar with no data behind it would be a
 * fabricated one.
 */
interface ClubsData {
  readonly clubs: readonly Club[];
  readonly state: ClubsRemoteState;
  readonly reload: () => void;
  readonly create: (name: string) => Promise<string>;
  readonly join: (inviteCode: string) => Promise<string>;
  readonly leave: (clubId: string) => Promise<string>;
  readonly archive: (clubId: string) => Promise<string>;
}

const useClubsData = (api: MobileApiClient, onSessionExpired: () => void): ClubsData => {
  const [clubs, setClubs] = useState<readonly Club[]>([]);
  const [state, setState] = useState<ClubsRemoteState>('loading');
  const mounted = useRef(true);
  const generation = useRef(0);
  const sessionExpirationHandled = useRef(false);

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    setState('loading');
    void api
      .listClubs()
      .then((next) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setClubs(next);
        setState(clubListState(next));
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        const next = clubsErrorState(error);
        setState(next);
        if (next === 'session-expired' && !sessionExpirationHandled.current) {
          sessionExpirationHandled.current = true;
          onSessionExpired();
        }
      });
  }, [api, onSessionExpired]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const create = useCallback(
    async (name: string) => {
      try {
        const club = await api.createClub(name);
        load();
        return `${club.name} created. Share the code ${club.inviteCode} to invite people.`;
      } catch (error) {
        return createFailureNotice(error);
      }
    },
    [api, load]
  );

  const join = useCallback(
    async (inviteCode: string) => {
      try {
        const club = await api.joinClub(inviteCode);
        load();
        return `You joined ${club.name}.`;
      } catch (error) {
        return joinFailureNotice(error);
      }
    },
    [api, load]
  );

  const leave = useCallback(
    async (clubId: string) => {
      try {
        await api.leaveClub(clubId);
        load();
        return 'You left the club.';
      } catch (error) {
        return leaveFailureNotice(error);
      }
    },
    [api, load]
  );

  const archive = useCallback(
    async (clubId: string) => {
      try {
        await api.archiveClub(clubId);
        load();
        return 'Club archived. Nobody can open it from the app now.';
      } catch (error) {
        return moderationFailureNotice(error);
      }
    },
    [api, load]
  );

  return { clubs, state, reload: load, create, join, leave, archive };
};

export function ClubsScreen({
  api,
  accountId,
  onSessionExpired
}: {
  api: MobileApiClient;
  accountId: string | undefined;
  onSessionExpired: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const { clubs, state, reload, create, join, leave, archive } = useClubsData(
    api,
    onSessionExpired
  );
  const [openClubId, setOpenClubId] = useState<string>();
  const [nameDraft, setNameDraft] = useState('');
  const [codeDraft, setCodeDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => clubRows(clubs), [clubs]);
  const open = clubs.find((club) => club.id === openClubId);

  const act = async (action: Promise<string>) => {
    setBusy(true);
    setNotice(await action);
    setBusy(false);
  };

  if (open)
    return (
      <ClubDetail
        api={api}
        club={open}
        accountId={accountId}
        busy={busy}
        onBack={() => {
          setOpenClubId(undefined);
          setNotice('');
        }}
        onLeave={async () => {
          await act(leave(open.id));
          setOpenClubId(undefined);
        }}
        onArchive={async () => {
          await act(archive(open.id));
          setOpenClubId(undefined);
        }}
      />
    );

  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {clubsStatusMessage(state, notice, clubs.length)}
      </Text>
      <Text style={styles.eyebrow}>INVITE ONLY</Text>
      <Text accessibilityRole="header" style={styles.homeTitle}>
        Clubs
      </Text>
      <Text style={styles.lead}>
        A club is private. There is no directory and no search: people join with a code somebody
        gives them. A club never sees a member&apos;s route, pace, or where they went.
      </Text>

      {notice !== '' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeCopy}>{notice}</Text>
          </View>
        </View>
      )}

      {state === 'loading' && <Text style={styles.rowDetail}>Loading your clubs.</Text>}

      {rows.length > 0 && (
        <SettingsGroup title="Your clubs">
          {rows.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`${row.accessibilityLabel} Open club.`}
              onPress={() => setOpenClubId(row.id)}
              style={styles.setting}
            >
              <View style={styles.flexCopy}>
                <Text style={styles.rowTitle}>{row.name}</Text>
                <Text style={styles.rowDetail}>
                  {row.roleLabel} · {row.memberLabel}
                </Text>
              </View>
              <Text style={styles.settingValue}>›</Text>
            </Pressable>
          ))}
        </SettingsGroup>
      )}

      {state === 'empty' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>You are not in a club yet</Text>
            <Text style={styles.noticeCopy}>
              Join one with a code, or start your own and share its code.
            </Text>
          </View>
        </View>
      )}

      <SettingsGroup title="Join with a code">
        <View style={styles.settingStack}>
          <Text style={styles.fieldLabel}>INVITE CODE</Text>
          <TextInput
            accessibilityLabel="Club invite code"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={32}
            onChangeText={setCodeDraft}
            placeholder="ABCDEFGHJK"
            placeholderTextColor={tokens.text.secondary}
            style={styles.input}
            value={codeDraft}
          />
          <PrimaryButton
            accessibilityLabel="Join club"
            label={busy ? 'Working…' : 'Join club'}
            disabled={busy || codeDraft.trim().length === 0}
            onPress={() =>
              void act(join(codeDraft)).then(() => {
                setCodeDraft('');
              })
            }
          />
        </View>
      </SettingsGroup>

      <SettingsGroup title="Start a club">
        <View style={styles.settingStack}>
          <Text style={styles.fieldLabel}>CLUB NAME</Text>
          <TextInput
            accessibilityLabel="New club name"
            maxLength={80}
            onChangeText={setNameDraft}
            placeholder="Morning Movers"
            placeholderTextColor={tokens.text.secondary}
            style={styles.input}
            value={nameDraft}
          />
          <PrimaryButton
            accessibilityLabel="Create club"
            label={busy ? 'Working…' : 'Create club'}
            disabled={busy}
            onPress={() => {
              const validation = validateClubName(nameDraft);
              if (!validation.ok) {
                setNotice(validation.message);
                return;
              }
              void act(create(validation.name)).then(() => {
                setNameDraft('');
              });
            }}
          />
          <Text style={styles.rowDetail}>
            You become the owner. RunSphere generates the invite code; you cannot choose it, and
            anyone with it can join.
          </Text>
        </View>
      </SettingsGroup>

      {(state === 'offline' || state === 'error' || state === 'configuration') && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>
              {state === 'configuration' ? 'Clubs need setup' : 'Clubs are unavailable'}
            </Text>
            <Text style={styles.noticeCopy}>
              {state === 'configuration'
                ? 'RunSphere needs an API URL before clubs can load.'
                : 'Your clubs could not load. Nothing was changed.'}
            </Text>
            {state !== 'configuration' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={reload}>
                <Text style={styles.textButton}>Try again</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </>
  );
}

function ClubDetail({
  api,
  club,
  accountId,
  busy,
  onBack,
  onLeave,
  onArchive
}: {
  api: MobileApiClient;
  club: Club;
  accountId: string | undefined;
  busy: boolean;
  onBack: () => void;
  onLeave: () => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const [members, setMembers] = useState<readonly ClubMember[]>([]);
  const [relays, setRelays] = useState<readonly ClubRelaySummary[]>([]);
  const [targetDraft, setTargetDraft] = useState('');
  const [state, setState] = useState<ClubsRemoteState>('loading');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(() => {
    setState('loading');
    void Promise.all([api.listClubMembers(club.id), api.listClubRelays(club.id)])
      .then(([nextMembers, nextRelays]) => {
        if (!mounted.current) return;
        setMembers(nextMembers);
        setRelays(nextRelays);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setState(clubsErrorState(error));
      });
  }, [api, club.id]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const rows = clubMemberRows(members, { accountId, role: club.role });
  const relayWeeks = relayRows(relays);
  const actions = clubActions(club);

  const moderate = async (action: Promise<unknown>, success: string) => {
    setWorking(true);
    try {
      await action;
      setNotice(success);
      load();
    } catch (error) {
      setNotice(moderationFailureNotice(error));
    }
    if (mounted.current) setWorking(false);
  };

  const blocked = busy || working;

  const setTarget = async () => {
    const validation = validateRelayTarget(targetDraft);
    if (!validation.ok) {
      setNotice(validation.message);
      return;
    }
    setWorking(true);
    try {
      await api.setClubRelayTarget(club.id, validation.targetUnits);
      setNotice(`This week target is ${validation.targetUnits} minutes.`);
      setTargetDraft('');
      load();
    } catch (error) {
      setNotice(relayFailureNotice(error));
    }
    if (mounted.current) setWorking(false);
  };

  return (
    <>
      <BackHeader label="CLUB" onBack={onBack} />
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {notice}
      </Text>
      <Text style={styles.eyebrow}>{club.role.toUpperCase()}</Text>
      <Text accessibilityRole="header" style={styles.homeTitle}>
        {club.name}
      </Text>
      <Text style={styles.lead}>
        {club.memberCount === 1 ? '1 member' : `${club.memberCount} members`}. Anyone with the
        invite code can join.
      </Text>

      {notice !== '' && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeCopy}>{notice}</Text>
          </View>
        </View>
      )}

      <SettingsGroup title="Invite code">
        <View style={styles.settingStack}>
          <Text
            accessibilityLabel={`Invite code ${[...club.inviteCode].join(' ')}`}
            style={styles.rowTitle}
          >
            {club.inviteCode}
          </Text>
          <Text style={styles.rowDetail}>
            Share this with people you want in the club. Anyone who has it can join, so treat it
            like a key.
          </Text>
        </View>
      </SettingsGroup>

      {state === 'loading' && <Text style={styles.rowDetail}>Loading the club.</Text>}

      {state === 'ready' && (
        <SettingsGroup title="Weekly relay">
          {relayWeeks.length === 0 && (
            <Text style={styles.settingsHint}>
              No relay target has been set yet.{' '}
              {canSetRelayTarget(club.role) ? 'Set one below.' : 'An owner or admin can set one.'}
            </Text>
          )}
          {relayWeeks.map((week) => (
            <View
              key={week.id}
              accessible
              accessibilityLabel={week.accessibilityLabel}
              style={styles.settingStack}
            >
              <View style={styles.cardTopline}>
                <View style={styles.flexCopy}>
                  <Text style={styles.eyebrow}>{week.weekLabel.toUpperCase()}</Text>
                  <Text style={styles.rowTitle}>{week.totalLabel}</Text>
                </View>
                <Text style={styles.settingValue}>{week.statusLabel}</Text>
              </View>
              <Text style={styles.rowDetail}>
                {week.contributorLabel}. {week.myLabel}.
              </Text>
            </View>
          ))}
          <Text style={styles.settingsHint}>{RELAY_EXPLANATION}</Text>
          {canSetRelayTarget(club.role) && (
            <View style={styles.settingStack}>
              <Text style={styles.fieldLabel}>THIS WEEK TARGET IN MINUTES</Text>
              <TextInput
                accessibilityLabel="Weekly relay target in minutes"
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setTargetDraft}
                placeholder="600"
                placeholderTextColor={tokens.text.secondary}
                style={styles.input}
                value={targetDraft}
              />
              <PrimaryButton
                accessibilityLabel="Save weekly relay target"
                label={working ? 'Saving…' : 'Save weekly target'}
                disabled={blocked}
                onPress={() => void setTarget()}
              />
              <Text style={styles.rowDetail}>
                This sets the target for the open week only. A week that has already been counted
                cannot be retargeted.
              </Text>
            </View>
          )}
        </SettingsGroup>
      )}

      {state === 'ready' && (
        <SettingsGroup title="Members">
          {rows.map((row) => (
            <View key={row.accountId} style={styles.settingStack}>
              <View
                accessible
                accessibilityLabel={row.accessibilityLabel}
                style={styles.cardTopline}
              >
                <View style={styles.flexCopy}>
                  <Text style={styles.rowTitle}>{row.nameLabel}</Text>
                  <Text style={styles.rowDetail}>{row.roleLabel}</Text>
                </View>
              </View>
              {(row.nextRole || row.canRemove) && (
                <View style={styles.filterRow}>
                  {row.nextRole && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        row.nextRole === 'admin'
                          ? `Make ${row.nameLabel} an admin`
                          : `Remove admin from ${row.nameLabel}`
                      }
                      disabled={blocked}
                      onPress={() =>
                        void moderate(
                          api.setClubMemberRole(club.id, row.accountId, row.nextRole!),
                          row.nextRole === 'admin'
                            ? `${row.nameLabel} is now an admin.`
                            : `${row.nameLabel} is now a member.`
                        )
                      }
                    >
                      <Text style={styles.textButton}>
                        {row.nextRole === 'admin' ? 'Make admin' : 'Remove admin'}
                      </Text>
                    </Pressable>
                  )}
                  {row.canRemove && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${row.nameLabel} from the club`}
                      accessibilityHint="They lose access immediately. They can rejoin with the invite code."
                      disabled={blocked}
                      onPress={() =>
                        void moderate(
                          api.removeClubMember(club.id, row.accountId),
                          `${row.nameLabel} was removed.`
                        )
                      }
                    >
                      <Text style={[styles.textButton, styles.destructive]}>Remove</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          ))}
          <Text style={styles.settingsHint}>
            Someone you have blocked is not listed here, and neither are you to them. The member
            count above still counts everyone.
          </Text>
        </SettingsGroup>
      )}

      {(state === 'offline' || state === 'error') && (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>i</Text>
          <View style={styles.flexCopy}>
            <Text style={styles.noticeTitle}>Members are unavailable</Text>
            <Text style={styles.noticeCopy}>The member list could not load.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={load}>
              <Text style={styles.textButton}>Try again</Text>
            </Pressable>
          </View>
        </View>
      )}

      <SettingsGroup title="Leaving">
        {actions.canLeave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave this club"
            disabled={blocked}
            onPress={() => void onLeave()}
            style={styles.setting}
          >
            <Text style={[styles.rowTitle, styles.destructive]}>Leave club</Text>
          </Pressable>
        ) : (
          <Text style={styles.settingsHint}>{actions.leaveBlockedReason}</Text>
        )}
        {actions.canArchive && !confirmArchive && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Archive this club"
            accessibilityHint={ARCHIVE_CONSEQUENCE}
            disabled={blocked}
            onPress={() => setConfirmArchive(true)}
            style={styles.setting}
          >
            <Text style={[styles.rowTitle, styles.destructive]}>Archive club</Text>
          </Pressable>
        )}
        {actions.canArchive && confirmArchive && (
          <View style={styles.settingStack}>
            <Text style={styles.rowDetail}>{ARCHIVE_CONSEQUENCE}</Text>
            <View style={styles.filterRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm archiving this club"
                disabled={blocked}
                onPress={() => void onArchive()}
              >
                <Text style={[styles.textButton, styles.destructive]}>Archive it</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Keep the club"
                onPress={() => setConfirmArchive(false)}
              >
                <Text style={styles.textButton}>Keep it</Text>
              </Pressable>
            </View>
          </View>
        )}
      </SettingsGroup>

      <Text style={styles.settingsHint}>
        Club boards and club challenges are not built yet. When they arrive a club will still see
        only aggregate totals — never a member&apos;s route, pace, or location.
      </Text>
    </>
  );
}
