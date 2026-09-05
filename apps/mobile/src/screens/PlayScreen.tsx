import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  ChallengeLengthDays,
  ChallengeMode,
  ChallengeResult,
  ChallengeSummary,
  CompetitionStandingsResponse,
  CompetitionSummary,
  FriendStandingsResponse,
  GlobalBoardResponse,
  TerritoryLadderResponse,
  TerritoryMapResponse,
  TerritorySeasonResponse,
  Profile
} from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { ApiFailure } from '../api-client';
import { FriendsScreen } from './FriendsScreen';
import { LoopCallout } from '../components/LoopCallout';
import { LoopMascot } from '../components/Mascot';
import { PrimaryButton } from '../components/primitives';
import { TerritoryPanel } from './TerritoryPanel';
import { useLoopGuidance } from '../components/useLoopGuidance';
import type { LoopGuidanceCue } from '../loop-guidance';
import { useAppTheme } from '../theme/theme';
import {
  CHALLENGE_MODE_LABEL,
  challengeListState,
  challengeOutcomeLine,
  challengeWindowLabel,
  createChallengeFailure,
  groupChallenges,
  invitableFriends,
  playErrorState,
  respondChallengeFailure,
  standingRows,
  standingsState,
  COMPETITION_ENTRY_CONSEQUENCE,
  GLOBAL_BOARD_JOIN_CONSEQUENCE,
  TERRITORY_JOIN_CONSEQUENCE,
  TERRITORY_NO_SEASON_MESSAGE,
  competitionFailureNotice,
  competitionProvisionalNotice,
  competitionRows,
  competitionStandingRows,
  currentCompetition,
  territoryFailureNotice,
  territorySeasonRow,
  globalBoardEmptyMessage,
  globalBoardRows,
  globalBoardState,
  globalDivisionLabel,
  globalSelfLabel,
  type PlayRemoteState
} from './play-model';

/**
 * The Play tab (ADR-0005, ADR-0007). Challenges and standings are read from the
 * server; this screen never derives a score. An in-progress challenge shows no
 * score because none exists until the worker closes the window, and the friend
 * board is empty until the account opts in.
 *
 * Only the modes the published v1 challenge rule enables are offered.
 * `quest_completion` is absent because no quest completion is recorded
 * server-side; the API answers `422` for it, which is surfaced verbatim if a
 * rule ever disagrees with this list.
 */
const OFFERED_MODES: readonly ChallengeMode[] = ['active_minutes', 'active_days'];
const OFFERED_LENGTHS: readonly ChallengeLengthDays[] = [3, 7];
const MAX_CONCURRENT_RESULTS = 3;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

interface PlayData {
  readonly challenges: readonly ChallengeSummary[];
  readonly challengeState: PlayRemoteState;
  readonly results: ReadonlyMap<string, ChallengeResult>;
  readonly standings: FriendStandingsResponse | undefined;
  readonly standingsRemoteState: PlayRemoteState;
  readonly globalBoard: GlobalBoardResponse | undefined;
  readonly globalBoardRemoteState: PlayRemoteState;
  readonly competitions: readonly CompetitionSummary[];
  readonly competitionStandings: CompetitionStandingsResponse | undefined;
  readonly competitionsRemoteState: PlayRemoteState;
  readonly territory: TerritorySeasonResponse | undefined;
  readonly territoryRemoteState: PlayRemoteState;
  /** The division ladder and the held-cell map, read only when a season exists. */
  readonly territoryLadder: TerritoryLadderResponse | undefined;
  readonly territoryMap: TerritoryMapResponse | undefined;
  readonly friends: readonly Profile[];
  readonly reload: () => void;
  readonly respond: (challengeId: string, accept: boolean) => Promise<string | undefined>;
  readonly create: (
    friendAccountId: string,
    mode: ChallengeMode,
    lengthDays: ChallengeLengthDays
  ) => Promise<string | undefined>;
  readonly setParticipating: (participating: boolean) => Promise<void>;
  readonly setGlobalParticipating: (participating: boolean) => Promise<string | undefined>;
  readonly setCompetitionEntry: (
    competitionId: string,
    enrolled: boolean
  ) => Promise<string | undefined>;
  readonly setTerritoryEnrolled: (
    seasonId: string,
    enrolled: boolean
  ) => Promise<string | undefined>;
}

const usePlayData = (api: MobileApiClient, onSessionExpired: () => void): PlayData => {
  const [challenges, setChallenges] = useState<readonly ChallengeSummary[]>([]);
  const [challengeState, setChallengeState] = useState<PlayRemoteState>('loading');
  const [results, setResults] = useState<ReadonlyMap<string, ChallengeResult>>(new Map());
  const [standings, setStandings] = useState<FriendStandingsResponse>();
  const [standingsRemoteState, setStandingsRemoteState] = useState<PlayRemoteState>('loading');
  const [globalBoard, setGlobalBoard] = useState<GlobalBoardResponse>();
  const [globalBoardRemoteState, setGlobalBoardRemoteState] = useState<PlayRemoteState>('loading');
  const [competitions, setCompetitions] = useState<readonly CompetitionSummary[]>([]);
  const [competitionStandings, setCompetitionStandings] = useState<CompetitionStandingsResponse>();
  const [competitionsRemoteState, setCompetitionsRemoteState] =
    useState<PlayRemoteState>('loading');
  const [territory, setTerritory] = useState<TerritorySeasonResponse>();
  const [territoryRemoteState, setTerritoryRemoteState] = useState<PlayRemoteState>('loading');
  const [territoryLadder, setTerritoryLadder] = useState<TerritoryLadderResponse>();
  const [territoryMap, setTerritoryMap] = useState<TerritoryMapResponse>();
  const [friends, setFriends] = useState<readonly Profile[]>([]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const sessionExpirationHandled = useRef(false);

  const expire = useCallback(
    (state: PlayRemoteState) => {
      if (state === 'session-expired' && !sessionExpirationHandled.current) {
        sessionExpirationHandled.current = true;
        onSessionExpired();
      }
    },
    [onSessionExpired]
  );

  /** Bounded so a long finished list cannot open one request per row at once. */
  const loadResults = useCallback(
    async (finished: readonly ChallengeSummary[], requestGeneration: number) => {
      const pending = [...finished];
      const loaded = new Map<string, ChallengeResult>();
      const workers = Array.from(
        { length: Math.min(MAX_CONCURRENT_RESULTS, pending.length) },
        async () => {
          for (let next = pending.shift(); next; next = pending.shift()) {
            try {
              loaded.set(next.id, await api.getChallengeResult(next.id));
            } catch (error) {
              // A `409` means the worker has not scored the window yet. That is
              // reported as pending, never as a zero or a loss.
              if (!(error instanceof ApiFailure)) throw error;
            }
          }
        }
      );
      await Promise.all(workers);
      if (!mounted.current || requestGeneration !== generation.current) return;
      setResults(loaded);
    },
    [api]
  );

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    setChallengeState('loading');
    setStandingsRemoteState('loading');
    setResults(new Map());
    void api
      .listChallenges()
      .then((next) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setChallenges(next);
        setChallengeState(challengeListState(groupChallenges(next)));
        void loadResults(
          next.filter((challenge) => challenge.status === 'finished'),
          requestGeneration
        );
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        const state = playErrorState(error);
        setChallengeState(state);
        expire(state);
      });
    void api
      .getFriendStandings()
      .then((next) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setStandings(next);
        setStandingsRemoteState(standingsState(next));
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setStandingsRemoteState(playErrorState(error));
      });
    void api
      .getTerritorySeason()
      .then(async (next) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setTerritory(next);
        setTerritoryRemoteState(next.season ? 'ready' : 'empty');
        // The ladder and the map are read only when a season exists. Asking for
        // them otherwise would be two requests whose only possible answer is
        // "there is no season", which the call above has already given.
        if (!next.season) {
          setTerritoryLadder(undefined);
          setTerritoryMap(undefined);
          return;
        }
        // Their own try, so a ladder or map that fails leaves the season card
        // standing. The season is the part somebody acts on — joining and
        // leaving — and losing it because a panel underneath it failed would
        // take away the working half of the screen along with the broken half.
        try {
          const [ladder, map] = await Promise.all([
            api.getTerritoryLadder(next.season.id),
            api.getTerritoryMap(next.season.id)
          ]);
          if (!mounted.current || requestGeneration !== generation.current) return;
          setTerritoryLadder(ladder);
          setTerritoryMap(map);
        } catch {
          if (!mounted.current || requestGeneration !== generation.current) return;
          setTerritoryLadder(undefined);
          setTerritoryMap(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setTerritoryRemoteState(playErrorState(error));
      });
    void api
      .listCompetitions()
      .then(async (next) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setCompetitions(next);
        // Standings are read for the competition the tab leads with, and only
        // that one: the rest are listed, not opened.
        const lead = currentCompetition(next);
        const standings = lead ? await api.getCompetitionStandings(lead.id) : undefined;
        if (!mounted.current || requestGeneration !== generation.current) return;
        setCompetitionStandings(standings);
        setCompetitionsRemoteState(next.length ? 'ready' : 'empty');
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setCompetitionsRemoteState(playErrorState(error));
      });
    void api
      .getGlobalBoard()
      .then((next) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setGlobalBoard(next);
        setGlobalBoardRemoteState(globalBoardState(next));
      })
      .catch((error: unknown) => {
        if (!mounted.current || requestGeneration !== generation.current) return;
        setGlobalBoardRemoteState(playErrorState(error));
      });
    void api
      .listFriends()
      .then((next) => {
        if (mounted.current && requestGeneration === generation.current) setFriends(next);
      })
      .catch(() => undefined);
  }, [api, expire, loadResults]);

  useEffect(() => {
    mounted.current = true;
    sessionExpirationHandled.current = false;
    load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  const respond = useCallback(
    async (challengeId: string, accept: boolean): Promise<string | undefined> => {
      try {
        await api.respondChallenge(challengeId, accept);
        load();
        return undefined;
      } catch (error) {
        return respondChallengeFailure(error);
      }
    },
    [api, load]
  );

  const create = useCallback(
    async (
      friendAccountId: string,
      mode: ChallengeMode,
      lengthDays: ChallengeLengthDays
    ): Promise<string | undefined> => {
      try {
        await api.createChallenge({ friendAccountId, mode, lengthDays });
        load();
        return undefined;
      } catch (error) {
        return createChallengeFailure(error);
      }
    },
    [api, load]
  );

  const setParticipating = useCallback(
    async (participating: boolean) => {
      try {
        await api.setFriendStandingsParticipation(participating);
        load();
      } catch {
        if (mounted.current) setStandingsRemoteState('error');
      }
    },
    [api, load]
  );

  /**
   * Joining or leaving the global board. The reload afterwards is what makes
   * the change visible: leaving takes the reader off the published board on
   * the server, so the next read is the truthful picture rather than a local
   * flag flipped ahead of it.
   */
  const setGlobalParticipating = useCallback(
    async (participating: boolean): Promise<string | undefined> => {
      try {
        await api.setGlobalBoardParticipation(participating);
        load();
        return undefined;
      } catch (error) {
        // A moderation decision arrives as a `403` carrying the statement staff
        // wrote; showing it beats a bare "unavailable".
        if (error instanceof ApiFailure && error.status === 403) return error.message;
        if (mounted.current) setGlobalBoardRemoteState('error');
        return undefined;
      }
    },
    [api, load]
  );

  /**
   * Entering or leaving a competition. The failure is returned rather than
   * thrown so the caller can show the published reason — a missed eligibility
   * band is a product state, not an error.
   */
  const setCompetitionEntry = useCallback(
    async (competitionId: string, enrolled: boolean) => {
      try {
        await api.setCompetitionEnrollment(competitionId, enrolled);
        load();
        return undefined;
      } catch (error) {
        return competitionFailureNotice(error);
      }
    },
    [api, load]
  );

  /**
   * Joining or leaving the season. The failure is returned rather than thrown
   * so the caller can show the server's own words — a season that closed while
   * somebody was reading is a product state, not an error.
   */
  const setTerritoryEnrolled = useCallback(
    async (seasonId: string, enrolled: boolean) => {
      try {
        const next = await api.setTerritoryEnrollment(seasonId, enrolled);
        if (mounted.current) {
          setTerritory(next);
          setTerritoryRemoteState(next.season ? 'ready' : 'empty');
        }
        return undefined;
      } catch (error) {
        return territoryFailureNotice(error);
      }
    },
    [api]
  );

  return {
    challenges,
    challengeState,
    results,
    standings,
    standingsRemoteState,
    globalBoard,
    globalBoardRemoteState,
    competitions,
    competitionStandings,
    competitionsRemoteState,
    territory,
    territoryRemoteState,
    territoryLadder,
    territoryMap,
    friends,
    reload: load,
    respond,
    create,
    setParticipating,
    setGlobalParticipating,
    setCompetitionEntry,
    setTerritoryEnrolled
  };
};

export function PlayScreen({
  api,
  accountId,
  onSessionExpired,
  initialScreen = 'play'
}: {
  api: MobileApiClient;
  accountId: string | undefined;
  onSessionExpired: () => void;
  /** Opens straight onto friends when arriving from a friend-request notice. */
  initialScreen?: 'play' | 'friends';
}) {
  const { tokens } = useAppTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const {
    challenges,
    challengeState,
    results,
    standings,
    standingsRemoteState,
    globalBoard,
    globalBoardRemoteState,
    competitions,
    competitionStandings,
    competitionsRemoteState,
    territory,
    territoryRemoteState,
    territoryLadder,
    territoryMap,
    friends,
    reload,
    respond,
    create,
    setParticipating,
    setGlobalParticipating,
    setCompetitionEntry,
    setTerritoryEnrolled
  } = usePlayData(api, onSessionExpired);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [composing, setComposing] = useState(false);
  // Friends are managed from Play because Play is where they are needed: a
  // challenge and the friend board both require a mutual friend.
  const [screen, setScreen] = useState<'play' | 'friends'>(initialScreen);

  const groups = useMemo(() => groupChallenges(challenges), [challenges]);
  const today = todayIso();
  const available = useMemo(() => invitableFriends(friends, challenges), [friends, challenges]);
  const rows = standings ? standingRows(standings) : [];
  const globalRows = globalBoard ? globalBoardRows(globalBoard) : [];
  const seasonRow = territory?.season ? territorySeasonRow(territory.season) : undefined;
  const competitionCards = competitionRows(competitions);
  const leadCompetition = currentCompetition(competitions);
  const competitionEntries = leadCompetition
    ? competitionStandingRows(competitionStandings?.entries ?? [], leadCompetition.mode)
    : [];

  // An invite waiting on the reader outranks an empty board: one asks for an
  // answer, the other only explains why a list is short.
  const guidanceCandidates = useMemo<readonly LoopGuidanceCue[]>(
    () => [
      ...(groups.incoming.length ? (['challenge-invite'] as const) : []),
      ...(challengeState === 'empty' ? (['play-empty'] as const) : [])
    ],
    [groups.incoming.length, challengeState]
  );
  const guidance = useLoopGuidance(guidanceCandidates);

  const answer = async (challengeId: string, accept: boolean) => {
    setBusyId(challengeId);
    setNotice((await respond(challengeId, accept)) ?? '');
    setBusyId(undefined);
  };

  if (screen === 'friends')
    return (
      <FriendsScreen
        api={api}
        onBack={() => {
          setScreen('play');
          reload();
        }}
        onSessionExpired={onSessionExpired}
      />
    );

  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>
        {notice}
      </Text>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PLAY</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Friendly challenges
        </Text>
        <Text style={styles.lead}>
          Challenges count active minutes and active days. Never pace, speed, or where you went.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage friends"
          onPress={() => setScreen('friends')}
          style={styles.guideAction}
        >
          <Text style={styles.guideActionText}>Friends and requests ›</Text>
        </Pressable>
      </View>

      {notice !== '' && (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      {challengeState === 'loading' && (
        <View style={styles.card}>
          <View style={[styles.skeleton, styles.skeletonTitle]} />
          <View style={[styles.skeleton, styles.skeletonLine]} />
          <Text style={styles.helper}>Loading challenges.</Text>
        </View>
      )}

      {(challengeState === 'ready' || challengeState === 'empty') && (
        <>
          <Section title="INVITES FOR YOU" styles={styles} hidden={!groups.incoming.length}>
            {guidance.cue === 'challenge-invite' && (
              <LoopCallout cue={guidance.cue} onDismiss={guidance.dismiss} />
            )}
            {groups.incoming.map((challenge) => (
              <View key={challenge.id} style={styles.card}>
                <ChallengeHeading styles={styles} challenge={challenge} today={today} />
                <Text style={styles.body}>
                  {challenge.opponent.displayName} invited you to a {challenge.lengthDays}-day{' '}
                  {CHALLENGE_MODE_LABEL[challenge.mode].toLowerCase()} challenge.
                </Text>
                <View style={styles.actionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Accept the challenge from ${challenge.opponent.displayName}`}
                    disabled={busyId === challenge.id}
                    onPress={() => void answer(challenge.id, true)}
                    style={styles.acceptButton}
                  >
                    <Text style={styles.acceptText}>Accept</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Decline the challenge from ${challenge.opponent.displayName}`}
                    disabled={busyId === challenge.id}
                    onPress={() => void answer(challenge.id, false)}
                    style={styles.declineButton}
                  >
                    <Text style={styles.declineText}>Not now</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </Section>

          <Section title="IN PROGRESS" styles={styles} hidden={!groups.active.length}>
            {groups.active.map((challenge) => (
              <View key={challenge.id} style={styles.card}>
                <ChallengeHeading styles={styles} challenge={challenge} today={today} />
                <Text style={styles.body}>
                  With {challenge.opponent.displayName}. Scores are counted once the challenge ends,
                  so neither of you sees a running total.
                </Text>
              </View>
            ))}
          </Section>

          <Section title="WAITING ON A REPLY" styles={styles} hidden={!groups.outgoing.length}>
            {groups.outgoing.map((challenge) => (
              <View key={challenge.id} style={styles.card}>
                <ChallengeHeading styles={styles} challenge={challenge} today={today} />
                <Text style={styles.body}>
                  {challenge.opponent.displayName} has not answered yet. An invite expires after
                  seven days.
                </Text>
              </View>
            ))}
          </Section>

          <Section title="FINISHED" styles={styles} hidden={!groups.finished.length}>
            {groups.finished.map((challenge) => {
              const outcome = challengeOutcomeLine(challenge, results.get(challenge.id), accountId);
              return (
                <View key={challenge.id} style={styles.card}>
                  <ChallengeHeading styles={styles} challenge={challenge} today={today} />
                  <View accessible accessibilityLabel={`${outcome.label}. ${outcome.detail}`}>
                    <Text style={styles.outcome}>{outcome.label}</Text>
                    <Text style={styles.body}>{outcome.detail}</Text>
                  </View>
                </View>
              );
            })}
          </Section>

          {challengeState === 'empty' && !composing && (
            <>
              <View style={styles.guide}>
                <LoopMascot variant="empty" accessibility={{ mode: 'decorative' }} size={48} />
                <View style={styles.flexCopy}>
                  <Text style={styles.body}>
                    No challenges yet. Invite a friend to a short, pace-neutral challenge.
                  </Text>
                </View>
              </View>
              {guidance.cue === 'play-empty' && (
                <LoopCallout cue={guidance.cue} onDismiss={guidance.dismiss} />
              )}
            </>
          )}
        </>
      )}

      {challengeState === 'offline' && (
        <Unavailable
          styles={styles}
          label="Challenges are unavailable offline."
          actionLabel="Try again"
          onAction={reload}
        />
      )}
      {challengeState === 'configuration' && (
        <Unavailable
          styles={styles}
          label="Challenges are unavailable until RunSphere is configured."
        />
      )}
      {challengeState === 'error' && (
        <Unavailable
          styles={styles}
          label="Challenges are unavailable."
          actionLabel="Try again"
          onAction={reload}
        />
      )}

      <ComposeChallenge
        styles={styles}
        open={composing}
        friends={available}
        hasFriends={friends.length > 0}
        onManageFriends={() => setScreen('friends')}
        onOpen={() => setComposing(true)}
        onCancel={() => setComposing(false)}
        onCreate={async (friendAccountId, mode, lengthDays) => {
          const failure = await create(friendAccountId, mode, lengthDays);
          setNotice(failure ?? '');
          if (!failure) setComposing(false);
        }}
      />

      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Friend standings
        </Text>
      </View>
      {standingsRemoteState === 'loading' && (
        <View style={styles.card}>
          <View style={[styles.skeleton, styles.skeletonLine]} />
          <Text style={styles.helper}>Loading standings.</Text>
        </View>
      )}
      {standings && !standings.participating && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>You are not on the friend board</Text>
          <Text style={styles.body}>
            Joining shares one number with mutual friends who have also joined: your counted active
            minutes this week. Never your route, pace, or where you went. You can leave at any time.
          </Text>
          <PrimaryButton
            label="Join the friend board"
            onPress={() => void setParticipating(true)}
          />
        </View>
      )}
      {standings?.participating && (
        <View style={styles.card}>
          <Text style={styles.weekLabel}>
            Week of {standings.periodStart} · counted active minutes
          </Text>
          {rows.map((row) => (
            <View
              key={row.accountId}
              accessible
              accessibilityLabel={row.accessibilityLabel}
              style={[styles.standingRow, row.isSelf && styles.standingSelf]}
            >
              <Text style={styles.rank}>{row.rank}</Text>
              <Text style={styles.standingName}>{row.nameLabel}</Text>
              <Text style={styles.standingScore}>{row.minutesLabel}</Text>
            </View>
          ))}
          {!rows.length && (
            <Text style={styles.body}>
              No mutual friend has joined the board yet. It fills in as they do.
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave the friend board"
            onPress={() => void setParticipating(false)}
            style={styles.guideAction}
          >
            <Text style={styles.guideActionText}>Leave the board</Text>
          </Pressable>
        </View>
      )}
      {standingsRemoteState === 'offline' && (
        <Unavailable
          styles={styles}
          label="Friend standings are unavailable offline."
          actionLabel="Try again"
          onAction={reload}
        />
      )}
      {standingsRemoteState === 'error' && (
        <Unavailable
          styles={styles}
          label="Friend standings are unavailable."
          actionLabel="Try again"
          onAction={reload}
        />
      )}

      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Global board
        </Text>
      </View>
      {globalBoardRemoteState === 'loading' && (
        <View style={styles.card}>
          <View style={[styles.skeleton, styles.skeletonLine]} />
          <Text style={styles.helper}>Loading the global board.</Text>
        </View>
      )}
      {globalBoard && !globalBoard.participating && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>You are not on the global board</Text>
          <Text style={styles.body}>{GLOBAL_BOARD_JOIN_CONSEQUENCE}</Text>
          <PrimaryButton
            label="Join the global board"
            onPress={() =>
              void setGlobalParticipating(true).then((failure) => setNotice(failure ?? ''))
            }
          />
        </View>
      )}
      {globalBoard?.participating && (
        <View style={styles.card}>
          <Text style={styles.weekLabel}>
            Week of {globalBoard.periodStart} · counted active minutes
            {globalBoard.division ? ` · ${globalDivisionLabel(globalBoard.division)}` : ''}
          </Text>
          {globalRows.map((row) => (
            <View
              key={row.accountId}
              accessible
              accessibilityLabel={row.accessibilityLabel}
              style={[styles.standingRow, row.isSelf && styles.standingSelf]}
            >
              <Text style={styles.rank}>{row.rank}</Text>
              <Text style={styles.standingName}>{row.nameLabel}</Text>
              <Text style={styles.standingScore}>{row.minutesLabel}</Text>
            </View>
          ))}
          {!globalRows.length && (
            <Text style={styles.body}>{globalBoardEmptyMessage(globalBoard)}</Text>
          )}
          {globalSelfLabel(globalBoard) && (
            <Text style={styles.helper}>{globalSelfLabel(globalBoard)}</Text>
          )}
          <Text style={styles.helper}>
            You are ranked in your division, which is decided by how many weeks you have been active
            — never by pace, distance, or place.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave the global board"
            onPress={() => void setGlobalParticipating(false)}
            style={styles.guideAction}
          >
            <Text style={styles.guideActionText}>Leave the global board</Text>
          </Pressable>
        </View>
      )}
      {globalBoardRemoteState === 'offline' && (
        <Unavailable
          styles={styles}
          label="The global board is unavailable offline."
          actionLabel="Try again"
          onAction={reload}
        />
      )}
      {globalBoardRemoteState === 'error' && (
        <Unavailable
          styles={styles}
          label="The global board is unavailable."
          actionLabel="Try again"
          onAction={reload}
        />
      )}

      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Season
        </Text>
      </View>
      {territoryRemoteState === 'loading' && (
        <View style={styles.card}>
          <View style={[styles.skeleton, styles.skeletonLine]} />
          <Text style={styles.helper}>Loading the season.</Text>
        </View>
      )}
      {territory && !territory.season && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No season is running</Text>
          <Text style={styles.body}>{TERRITORY_NO_SEASON_MESSAGE}</Text>
          <Text style={styles.helper}>{territory.captureNote}</Text>
        </View>
      )}
      {territory?.season && seasonRow && (
        <View accessible accessibilityLabel={seasonRow.accessibilityLabel} style={styles.card}>
          <Text style={styles.weekLabel}>{seasonRow.statusLabel}</Text>
          <Text style={styles.cardTitle}>{seasonRow.titleLabel}</Text>
          <Text style={styles.body}>
            {`${seasonRow.windowLabel} · ${seasonRow.participantLabel}`}
          </Text>
          {seasonRow.divisionLabel ? (
            <>
              <Text style={styles.body}>{`Your group: ${seasonRow.divisionLabel}`}</Text>
              <Text style={styles.helper}>{seasonRow.divisionExplanation}</Text>
            </>
          ) : null}
          {!seasonRow.enrolled && seasonRow.canJoin ? (
            <Text style={styles.body}>{TERRITORY_JOIN_CONSEQUENCE}</Text>
          ) : null}
          {/*
            The note is shown to anybody looking at a season, joined or not:
            the word "season" promises a map, and there is no map yet.
          */}
          <Text style={styles.helper}>{territory.captureNote}</Text>
          {seasonRow.canJoin ? (
            <PrimaryButton
              label={seasonRow.enrolled ? 'Leave the season' : 'Take part'}
              onPress={() =>
                void setTerritoryEnrolled(territory.season!.id, !seasonRow.enrolled).then(
                  (failure) => setNotice(failure ?? '')
                )
              }
            />
          ) : null}
        </View>
      )}
      {territory?.season && seasonRow ? (
        // The map has no H3 binding in this app, so it renders its stated
        // reason rather than a blank city (milestone 4.5).
        <TerritoryPanel ladder={territoryLadder} map={territoryMap} />
      ) : null}
      {territoryRemoteState === 'offline' && (
        <Unavailable
          styles={styles}
          label="The season is unavailable offline."
          actionLabel="Try again"
          onAction={reload}
        />
      )}
      {territoryRemoteState === 'error' && (
        <Unavailable
          styles={styles}
          label="The season is unavailable."
          actionLabel="Try again"
          onAction={reload}
        />
      )}

      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Competitions
        </Text>
      </View>
      {competitionsRemoteState === 'loading' && (
        <View style={styles.card}>
          <View style={[styles.skeleton, styles.skeletonLine]} />
          <Text style={styles.helper}>Loading competitions.</Text>
        </View>
      )}
      {competitionsRemoteState === 'empty' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No competition is scheduled</Text>
          <Text style={styles.body}>
            Competitions are announced in advance with their window, eligibility, and rewards. There
            is nothing to enter right now.
          </Text>
        </View>
      )}
      {competitionCards.map((row) => (
        <View
          key={row.id}
          accessible
          accessibilityLabel={row.accessibilityLabel}
          style={styles.card}
        >
          <Text style={styles.weekLabel}>{row.statusLabel}</Text>
          <Text style={styles.cardTitle}>{row.title}</Text>
          <Text style={styles.body}>{`${row.windowLabel} · ${row.participantLabel}`}</Text>
          {row.rewardsLabel !== '' && (
            <Text style={styles.helper}>{`Rewards: ${row.rewardsLabel}`}</Text>
          )}
          {row.eligibilityLabel && <Text style={styles.helper}>{row.eligibilityLabel}</Text>}
          {!row.enrolled && row.canEnter && (
            <Text style={styles.body}>{COMPETITION_ENTRY_CONSEQUENCE}</Text>
          )}
          {row.canEnter && (
            <PrimaryButton
              label={row.enrolled ? 'Leave the competition' : 'Enter the competition'}
              onPress={() =>
                void setCompetitionEntry(row.id, !row.enrolled).then((failure) =>
                  setNotice(failure ?? '')
                )
              }
            />
          )}
          {leadCompetition?.id === row.id && row.enrolled && (
            <>
              {competitionProvisionalNotice(leadCompetition) && (
                <Text style={styles.helper}>{competitionProvisionalNotice(leadCompetition)}</Text>
              )}
              {competitionEntries.map((entry) => (
                <View
                  key={entry.accountId}
                  accessible
                  accessibilityLabel={entry.accessibilityLabel}
                  style={[styles.standingRow, entry.isSelf && styles.standingSelf]}
                >
                  <Text style={styles.rank}>{entry.rank}</Text>
                  <Text style={styles.standingName}>{entry.nameLabel}</Text>
                  <Text style={styles.standingScore}>{entry.scoreLabel}</Text>
                </View>
              ))}
              {!competitionEntries.length && (
                <Text style={styles.helper}>
                  No entrant has counted minutes in this window yet.
                </Text>
              )}
            </>
          )}
        </View>
      ))}
      {competitionsRemoteState === 'offline' && (
        <Unavailable
          styles={styles}
          label="Competitions are unavailable offline."
          actionLabel="Try again"
          onAction={reload}
        />
      )}
      {competitionsRemoteState === 'error' && (
        <Unavailable
          styles={styles}
          label="Competitions are unavailable."
          actionLabel="Try again"
          onAction={reload}
        />
      )}

      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>⌁</Text>
        <View style={styles.flexCopy}>
          <Text style={styles.noticeTitle}>Private by design</Text>
          <Text style={styles.noticeCopy}>
            A challenge or standing shares only consented weekly totals. No territory season is
            active, and territory stays off until a future enrollment flag opens.
          </Text>
        </View>
      </View>
    </>
  );
}

function ChallengeHeading({
  styles,
  challenge,
  today
}: {
  styles: ReturnType<typeof createStyles>;
  challenge: ChallengeSummary;
  today: string;
}) {
  // The mode, the opponent, and the window are one fact about one challenge,
  // so TalkBack reads them together instead of as three stray fragments. The
  // heading holds no controls, so grouping hides nothing focusable.
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${CHALLENGE_MODE_LABEL[challenge.mode]} challenge with ${
        challenge.opponent.displayName
      }. ${challengeWindowLabel(challenge, today)}.`}
      style={styles.cardHeader}
    >
      <View style={styles.flexCopy}>
        <Text style={styles.eyebrow}>{CHALLENGE_MODE_LABEL[challenge.mode].toUpperCase()}</Text>
        <Text style={styles.cardTitle}>{challenge.opponent.displayName}</Text>
      </View>
      <Text style={styles.windowBadge}>{challengeWindowLabel(challenge, today)}</Text>
    </View>
  );
}

function Section({
  title,
  styles,
  hidden,
  children
}: {
  title: string;
  styles: ReturnType<typeof createStyles>;
  hidden: boolean;
  children: React.ReactNode;
}) {
  if (hidden) return null;
  return (
    <View>
      <Text accessibilityRole="header" style={styles.groupLabel}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function ComposeChallenge({
  styles,
  open,
  friends,
  hasFriends,
  onManageFriends,
  onOpen,
  onCancel,
  onCreate
}: {
  styles: ReturnType<typeof createStyles>;
  open: boolean;
  friends: readonly Profile[];
  hasFriends: boolean;
  onManageFriends: () => void;
  onOpen: () => void;
  onCancel: () => void;
  onCreate: (
    friendAccountId: string,
    mode: ChallengeMode,
    lengthDays: ChallengeLengthDays
  ) => Promise<void>;
}) {
  const [friendId, setFriendId] = useState<string>();
  const [mode, setMode] = useState<ChallengeMode>('active_minutes');
  const [lengthDays, setLengthDays] = useState<ChallengeLengthDays>(3);
  const [saving, setSaving] = useState(false);

  if (!open)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a new challenge"
        onPress={onOpen}
        style={styles.composeButton}
      >
        <Text style={styles.composeText}>Challenge a friend</Text>
      </Pressable>
    );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Challenge a friend</Text>
      {!hasFriends && (
        <>
          <Text style={styles.body}>
            A challenge needs a mutual friend. Adding someone takes the exact email they signed up
            with, and they choose whether to accept.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Manage friends"
            onPress={onManageFriends}
            style={styles.guideAction}
          >
            <Text style={styles.guideActionText}>Add a friend ›</Text>
          </Pressable>
        </>
      )}
      {hasFriends && !friends.length && (
        <Text style={styles.body}>Every mutual friend already has a challenge open with you.</Text>
      )}
      {friends.length > 0 && (
        <>
          <Text style={styles.fieldLabel}>FRIEND</Text>
          <View style={styles.chipRow}>
            {friends.map((friend) => (
              <Pressable
                key={friend.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: friendId === friend.id }}
                accessibilityLabel={friend.displayName}
                onPress={() => setFriendId(friend.id)}
                style={[styles.chip, friendId === friend.id && styles.chipSelected]}
              >
                <Text style={[styles.chipText, friendId === friend.id && styles.chipTextSelected]}>
                  {friend.displayName}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.fieldLabel}>WHAT TO COUNT</Text>
          <View style={styles.chipRow}>
            {OFFERED_MODES.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === option }}
                accessibilityLabel={CHALLENGE_MODE_LABEL[option]}
                onPress={() => setMode(option)}
                style={[styles.chip, mode === option && styles.chipSelected]}
              >
                <Text style={[styles.chipText, mode === option && styles.chipTextSelected]}>
                  {CHALLENGE_MODE_LABEL[option]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.fieldLabel}>HOW LONG</Text>
          <View style={styles.chipRow}>
            {OFFERED_LENGTHS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: lengthDays === option }}
                accessibilityLabel={`${option} days`}
                onPress={() => setLengthDays(option)}
                style={[styles.chip, lengthDays === option && styles.chipSelected]}
              >
                <Text
                  style={[styles.chipText, lengthDays === option && styles.chipTextSelected]}
                >{`${option} days`}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.helper}>
            The window starts when your friend accepts, so a slow reply costs them nothing.
          </Text>
          <PrimaryButton
            label={saving ? 'Sending…' : 'Send invite'}
            disabled={saving || !friendId}
            onPress={() => {
              if (!friendId) return;
              setSaving(true);
              void onCreate(friendId, mode, lengthDays).finally(() => setSaving(false));
            }}
          />
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel the new challenge"
        onPress={onCancel}
        style={styles.guideAction}
      >
        <Text style={styles.guideActionText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function Unavailable({
  styles,
  label,
  actionLabel,
  onAction
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.body}>{label}</Text>
      {actionLabel && onAction && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={styles.guideAction}
        >
          <Text style={styles.guideActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = (t: ReturnType<typeof useAppTheme>['tokens']) =>
  StyleSheet.create({
    liveStatus: { color: t.text.secondary, fontSize: 1, height: 1, opacity: 0, width: 1 },
    header: { justifyContent: 'center', marginBottom: 4, minHeight: 88 },
    flexCopy: { flex: 1 },
    eyebrow: { color: t.status.success, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
    title: {
      color: t.text.primary,
      fontSize: 30,
      fontWeight: '900',
      letterSpacing: -1,
      lineHeight: 35,
      marginTop: 5
    },
    lead: { color: t.text.secondary, fontSize: 14, lineHeight: 21, marginTop: 8 },
    groupLabel: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 1.2,
      marginTop: 20
    },
    sectionHeader: { marginTop: 26 },
    sectionTitle: { color: t.text.primary, fontSize: 20, fontWeight: '900', lineHeight: 26 },
    card: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 22,
      borderWidth: 1,
      marginTop: 12,
      padding: 16
    },
    cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
    cardTitle: {
      color: t.text.primary,
      fontSize: 19,
      fontWeight: '900',
      lineHeight: 25,
      marginTop: 4
    },
    windowBadge: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 14,
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 9,
      paddingVertical: 6
    },
    body: { color: t.text.secondary, fontSize: 14, lineHeight: 21, marginTop: 8 },
    outcome: { color: t.text.primary, fontSize: 16, fontWeight: '900', marginTop: 10 },
    helper: { color: t.text.secondary, fontSize: 12, lineHeight: 18, marginTop: 12 },
    weekLabel: { color: t.text.secondary, fontSize: 12, lineHeight: 18 },
    actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
    acceptButton: {
      alignItems: 'center',
      backgroundColor: t.action.primary,
      borderRadius: 16,
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 16
    },
    acceptText: { color: t.text.onAccent, fontSize: 15, fontWeight: '900' },
    declineButton: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderRadius: 16,
      borderWidth: 1,
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 16
    },
    declineText: { color: t.text.primary, fontSize: 15, fontWeight: '900' },
    composeButton: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderRadius: 18,
      borderWidth: 1,
      justifyContent: 'center',
      marginTop: 16,
      minHeight: 52
    },
    composeText: { color: t.text.primary, fontSize: 15, fontWeight: '900' },
    fieldLabel: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 1.1,
      marginTop: 16
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    chip: {
      alignItems: 'center',
      backgroundColor: t.background.surfaceInset,
      borderColor: t.border.subtle,
      borderRadius: 16,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 14
    },
    chipSelected: { backgroundColor: t.action.primary, borderColor: t.action.primary },
    chipText: { color: t.text.primary, fontSize: 14, fontWeight: '800' },
    chipTextSelected: { color: t.text.onAccent },
    standingRow: {
      alignItems: 'center',
      borderTopColor: t.border.subtle,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 12,
      minHeight: 52,
      paddingVertical: 8
    },
    standingSelf: { backgroundColor: t.background.surfaceInset },
    rank: { color: t.text.secondary, fontSize: 14, fontWeight: '900', minWidth: 24 },
    standingName: { color: t.text.primary, flex: 1, fontSize: 15, fontWeight: '800' },
    standingScore: { color: t.status.success, fontSize: 15, fontWeight: '900' },
    guide: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 16, minHeight: 64 },
    guideAction: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      marginTop: 10,
      minHeight: 48,
      paddingHorizontal: 4
    },
    guideActionText: { color: t.action.primary, fontSize: 14, fontWeight: '900' },
    unavailable: { marginTop: 12, minHeight: 64 },
    noticeCard: {
      backgroundColor: t.background.surfaceInset,
      borderRadius: 16,
      marginTop: 12,
      padding: 12
    },
    noticeText: { color: t.text.primary, fontSize: 14, lineHeight: 20 },
    notice: {
      backgroundColor: t.background.surface,
      borderColor: t.border.subtle,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginTop: 24,
      padding: 14
    },
    noticeIcon: { color: t.status.success, fontSize: 18, fontWeight: '900' },
    noticeTitle: { color: t.text.primary, fontSize: 15, fontWeight: '900' },
    noticeCopy: { color: t.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
    skeleton: { backgroundColor: t.background.surfaceInset, borderRadius: 6, marginTop: 12 },
    skeletonTitle: { height: 24, width: '62%' },
    skeletonLine: { height: 16, width: '82%' }
  });
