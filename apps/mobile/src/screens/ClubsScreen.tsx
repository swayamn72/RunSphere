import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type {
  Club,
  ClubBoardResponse,
  ClubChallengeMode,
  ClubChallengeStandingsResponse,
  ClubChallengeSummary,
  ClubMember,
  ClubRelaySummary
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { BackHeader, PrimaryButton, SettingsGroup } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import {
  ARCHIVE_CONSEQUENCE,
  CLUB_BOARD_EXPLANATION,
  CLUB_BOARD_JOIN_CONSEQUENCE,
  CLUB_BOARD_OFF_EXPLANATION,
  CLUB_CHALLENGE_CANCEL_CONSEQUENCE,
  CLUB_CHALLENGE_EXPLANATION,
  CLUB_CHALLENGE_JOIN_CONSEQUENCE,
  CLUB_CHALLENGE_LENGTHS,
  CLUB_CHALLENGE_MODE_LABEL,
  CLUB_CHALLENGE_OFF_EXPLANATION,
  RELAY_EXPLANATION,
  canOpenClubChallenge,
  canSetRelayTarget,
  clubBoardEmptyMessage,
  clubBoardFailureNotice,
  clubBoardRows,
  clubChallengeEmptyMessage,
  clubChallengeFailureNotice,
  clubChallengeRows,
  clubChallengeStandingRows,
  currentClubChallenge,
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
 * Relay progress arrived with milestone 3.2 and the weekly board with 3.3.
 * The board is opt-in and shows nothing until the reader joins it, because
 * reading other members' scores means publishing your own.
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
  const [board, setBoard] = useState<ClubBoardResponse | undefined>(undefined);
  const [challenges, setChallenges] = useState<readonly ClubChallengeSummary[]>([]);
  const [challengeStandings, setChallengeStandings] = useState<
    ClubChallengeStandingsResponse | undefined
  >(undefined);
  const [modeDraft, setModeDraft] = useState<ClubChallengeMode>('active_minutes');
  const [lengthDraft, setLengthDraft] = useState<number>(7);
  const [targetDraft, setTargetDraft] = useState('');
  const [state, setState] = useState<ClubsRemoteState>('loading');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(() => {
    setState('loading');
    void Promise.all([
      api.listClubMembers(club.id),
      api.listClubRelays(club.id),
      api.getClubBoard(club.id),
      api.listClubChallenges(club.id)
    ])
      .then(async ([nextMembers, nextRelays, nextBoard, nextChallenges]) => {
        if (!mounted.current) return;
        setMembers(nextMembers);
        setRelays(nextRelays);
        setBoard(nextBoard);
        setChallenges(nextChallenges);
        // Standings are read for the contest the tab leads with, and only that
        // one: a club runs one challenge at a time.
        const lead = currentClubChallenge(nextChallenges);
        setChallengeStandings(
          lead ? await api.getClubChallengeStandings(club.id, lead.id) : undefined
        );
        if (!mounted.current) return;
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
  const boardStandings = clubBoardRows(board?.entries ?? []);
  const leadChallenge = currentClubChallenge(challenges);
  const openChallenge = leadChallenge ? clubChallengeRows([leadChallenge])[0] : undefined;
  const standingRows = leadChallenge
    ? clubChallengeStandingRows(challengeStandings?.entries ?? [], leadChallenge.mode)
    : [];
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

  /**
   * Joining or leaving club boards. The reload afterwards is what makes the
   * change visible: leaving empties the board on the next read, which is the
   * honest picture of what the server will now return.
   */
  const setBoardParticipation = async (participating: boolean) => {
    setWorking(true);
    try {
      await api.setClubBoardParticipation(participating);
      setNotice(
        participating
          ? 'You are on club boards. Your weekly counted minutes are visible to members of your clubs.'
          : 'You have left club boards. Your minutes are no longer shown to other members.'
      );
      load();
    } catch (error) {
      setNotice(clubBoardFailureNotice(error));
    }
    if (mounted.current) setWorking(false);
  };

  /**
   * Joining or leaving the club challenge. The reload afterwards is what makes
   * the change visible: leaving empties the standings on the next read, which
   * is what the server will now return.
   */
  const joinChallenge = async (participating: boolean) => {
    if (!leadChallenge) return;
    setWorking(true);
    try {
      await api.setClubChallengeParticipation(club.id, leadChallenge.id, participating);
      setNotice(
        participating
          ? 'You are in the challenge. Your score for this window is visible to the others in it.'
          : 'You have left the challenge. You are no longer counted or shown in it.'
      );
      load();
    } catch (error) {
      setNotice(clubChallengeFailureNotice(error));
    }
    if (mounted.current) setWorking(false);
  };

  const openNewChallenge = async () => {
    setWorking(true);
    try {
      await api.openClubChallenge(club.id, modeDraft, lengthDraft);
      setNotice('The challenge is open. Members join it for themselves.');
      load();
    } catch (error) {
      setNotice(clubChallengeFailureNotice(error));
    }
    if (mounted.current) setWorking(false);
  };

  const cancelChallenge = async () => {
    if (!leadChallenge) return;
    setWorking(true);
    try {
      await api.cancelClubChallenge(club.id, leadChallenge.id);
      setNotice('The challenge is cancelled. Nothing was scored and no result was kept.');
      load();
    } catch (error) {
      setNotice(clubChallengeFailureNotice(error));
    }
    if (mounted.current) setWorking(false);
  };

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

      {state === 'ready' && board && (
        <SettingsGroup title="Weekly board">
          {!board.participating && (
            <Text style={styles.settingsHint}>{CLUB_BOARD_OFF_EXPLANATION}</Text>
          )}
          {board.participating && boardStandings.length === 0 && (
            <Text style={styles.settingsHint}>{clubBoardEmptyMessage(board.ruleVersion)}</Text>
          )}
          {board.participating &&
            boardStandings.map((entry) => (
              <View
                key={entry.accountId}
                accessible
                accessibilityLabel={entry.accessibilityLabel}
                style={styles.cardTopline}
              >
                <View style={styles.flexCopy}>
                  <Text style={styles.eyebrow}>{entry.rankLabel}</Text>
                  <Text style={styles.rowTitle}>
                    {entry.nameLabel}
                    {entry.isSelf ? ' (you)' : ''}
                  </Text>
                </View>
                <Text style={styles.settingValue}>{entry.minutesLabel}</Text>
              </View>
            ))}
          <Text style={styles.settingsHint}>
            {board.participating ? CLUB_BOARD_EXPLANATION : CLUB_BOARD_JOIN_CONSEQUENCE}
          </Text>
          <PrimaryButton
            accessibilityLabel={board.participating ? 'Leave club boards' : 'Join club boards'}
            label={board.participating ? 'Leave club boards' : 'Join club boards'}
            disabled={blocked}
            onPress={() => void setBoardParticipation(!board.participating)}
          />
        </SettingsGroup>
      )}

      {state === 'ready' && (
        <SettingsGroup title="Club challenge">
          {!openChallenge && (
            <Text style={styles.settingsHint}>
              {clubChallengeEmptyMessage(canOpenClubChallenge(club.role))}
            </Text>
          )}
          {openChallenge && (
            <View
              accessible
              accessibilityLabel={openChallenge.accessibilityLabel}
              style={styles.settingStack}
            >
              <View style={styles.cardTopline}>
                <View style={styles.flexCopy}>
                  <Text style={styles.eyebrow}>{openChallenge.statusLabel.toUpperCase()}</Text>
                  <Text style={styles.rowTitle}>{openChallenge.modeLabel}</Text>
                </View>
                <Text style={styles.settingValue}>{openChallenge.participantLabel}</Text>
              </View>
              <Text style={styles.rowDetail}>{openChallenge.windowLabel}</Text>
            </View>
          )}
          {openChallenge && !openChallenge.joined && (
            <Text style={styles.settingsHint}>{CLUB_CHALLENGE_JOIN_CONSEQUENCE}</Text>
          )}
          {openChallenge && openChallenge.joined && standingRows.length === 0 && (
            <Text style={styles.settingsHint}>
              Nobody in this challenge has counted minutes yet.
            </Text>
          )}
          {openChallenge &&
            openChallenge.joined &&
            standingRows.map((entry) => (
              <View
                key={entry.accountId}
                accessible
                accessibilityLabel={entry.accessibilityLabel}
                style={styles.cardTopline}
              >
                <View style={styles.flexCopy}>
                  <Text style={styles.eyebrow}>{entry.rankLabel}</Text>
                  <Text style={styles.rowTitle}>
                    {entry.nameLabel}
                    {entry.isSelf ? ' (you)' : ''}
                  </Text>
                </View>
                <Text style={styles.settingValue}>{entry.scoreLabel}</Text>
              </View>
            ))}
          {openChallenge && !openChallenge.joined && challengeStandings?.final === false && (
            <Text style={styles.settingsHint}>{CLUB_CHALLENGE_OFF_EXPLANATION}</Text>
          )}
          {openChallenge && openChallenge.open && (
            <PrimaryButton
              accessibilityLabel={openChallenge.joined ? 'Leave challenge' : 'Join challenge'}
              label={openChallenge.joined ? 'Leave challenge' : 'Join challenge'}
              disabled={blocked}
              onPress={() => void joinChallenge(!openChallenge.joined)}
            />
          )}
          <Text style={styles.settingsHint}>{CLUB_CHALLENGE_EXPLANATION}</Text>
          {openChallenge && openChallenge.open && canOpenClubChallenge(club.role) && (
            <View style={styles.settingStack}>
              <Text style={styles.rowDetail}>{CLUB_CHALLENGE_CANCEL_CONSEQUENCE}</Text>
              <Pressable
                accessibilityLabel="Cancel challenge"
                accessibilityRole="button"
                disabled={blocked}
                onPress={() => void cancelChallenge()}
              >
                <Text style={styles.textButton}>Cancel challenge</Text>
              </Pressable>
            </View>
          )}
          {!openChallenge?.open && canOpenClubChallenge(club.role) && (
            <View style={styles.settingStack}>
              <Text style={styles.fieldLabel}>OPEN A CHALLENGE</Text>
              <View style={styles.filterRow}>
                {(['active_minutes', 'active_days'] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    accessibilityLabel={`Score on ${CLUB_CHALLENGE_MODE_LABEL[mode]}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: modeDraft === mode }}
                    onPress={() => setModeDraft(mode)}
                  >
                    <Text style={modeDraft === mode ? styles.rowTitle : styles.textButton}>
                      {CLUB_CHALLENGE_MODE_LABEL[mode]}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.filterRow}>
                {CLUB_CHALLENGE_LENGTHS.map((length) => (
                  <Pressable
                    key={length}
                    accessibilityLabel={`Run for ${length} days`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: lengthDraft === length }}
                    onPress={() => setLengthDraft(length)}
                  >
                    <Text style={lengthDraft === length ? styles.rowTitle : styles.textButton}>
                      {length} days
                    </Text>
                  </Pressable>
                ))}
              </View>
              <PrimaryButton
                accessibilityLabel="Open challenge"
                label={working ? 'Opening…' : 'Open challenge'}
                disabled={blocked}
                onPress={() => void openNewChallenge()}
              />
              <Text style={styles.rowDetail}>
                Opening a challenge does not put you in it. Every member joins for themselves.
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
        The board and the challenge show only the counted minutes of members who joined them, and a
        club will never see a member&apos;s route, pace, or location.
      </Text>
    </>
  );
}
