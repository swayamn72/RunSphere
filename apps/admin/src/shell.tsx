import { useEffect, useState, type FormEvent } from 'react';
import {
  AREAS,
  AREA_GROUPS,
  AUDIT_NOTICE,
  NO_ROLES_MESSAGE,
  initialArea,
  permittedAreas,
  roleLabels,
  type AreaKey
} from './areas.js';
import { areaFromSearch, searchForArea } from './area-url.js';
import { clearStaffSession, getStaffRoles, signIn } from './api.js';
import type { AreaContext } from './area-types.js';
import { CampaignsArea } from './campaigns-area.js';
import { CompetitionsArea } from './competitions-area.js';
import { DataArea } from './data-area.js';
import { ModerationArea } from './moderation-area.js';
import { PrivacyArea } from './privacy-area.js';
import { QuestsAreaLoader } from './quests-area.js';
import { ReviewArea } from './review-area.js';
import { SeasonsArea } from './seasons-area.js';
import { TurfAreaLoader } from './turf-area.js';
import {
  AccountMenu,
  Button,
  Field,
  Notice,
  PageHeader,
  Section,
  StatusTag,
  ThemeSwitch
} from './ui/index.js';

/** What staff cannot see, said once on every page rather than only at sign-in. */
const PRIVACY_STATEMENT =
  'Authenticated staff access. Raw GPS and account contact details are unavailable here. Season operations show divisions, concentration, and week snapshots — never a participant against a cell.';

/** Which component runs each area. An area with no entry here has no route yet. */
const AREA_VIEWS: Partial<Record<AreaKey, (context: AreaContext) => React.ReactElement>> = {
  review: (context) => <ReviewArea {...context} />,
  moderation: (context) => <ModerationArea {...context} />,
  competitions: (context) => <CompetitionsArea {...context} />,
  turf: (context) => <TurfAreaLoader {...context} />,
  quests: (context) => <QuestsAreaLoader {...context} />,
  seasons: (context) => <SeasonsArea {...context} />,
  campaigns: (context) => <CampaignsArea {...context} />,
  privacy: (context) => <PrivacyArea {...context} />,
  data: (context) => <DataArea {...context} />
};

/**
 * The operations console (Phase 3, milestone 3.10).
 *
 * Five milestones shipped staff routes with nothing in front of them. This is
 * the interface, gated by the same predicates the API enforces, so what a
 * person can see here is exactly what their role can do there.
 *
 * Areas without a route say so instead of pretending — a console that looks
 * operational and quietly does nothing is worse than one that admits the gap.
 *
 * The shell holds only the session, the roles and which area is open. Each
 * area loads and owns its own data when it opens.
 */
export function AdminShell() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState<string>();
  const [roles, setRoles] = useState<readonly string[]>([]);
  const [area, setArea] = useState<AreaKey>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const run = async (work: () => Promise<unknown>, success?: string) => {
    setLoading(true);
    setError(undefined);
    // An action with its own message replaces the last one. A reload that
    // follows an action (it runs through here too) must not wipe the message
    // the person has not read yet.
    if (success) setNotice(undefined);
    try {
      await work();
      if (success) setNotice(success);
    } catch (reason) {
      setNotice(undefined);
      // The server's message is the useful one: a role refusal, a rule that
      // does not allow something, a state that has moved on.
      setError(reason instanceof Error ? reason.message : 'That did not work');
    } finally {
      setLoading(false);
    }
  };

  const openArea = (next: AreaKey, history: 'push' | 'replace' = 'push') => {
    setArea(next);
    setMenuOpen(false);
    setError(undefined);
    setNotice(undefined);
    const search = searchForArea(window.location.search, next);
    // Signing in replaces the entry, so Back from the next area lands on this one.
    if (history === 'push') window.history.pushState(null, '', search);
    else window.history.replaceState(null, '', search);
  };

  // Back and forward move between areas, never past the role gate.
  useEffect(() => {
    if (!accessToken) return;
    const onPop = () => {
      const wanted = areaFromSearch(window.location.search, roles);
      if (wanted) {
        setArea(wanted);
        setMenuOpen(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [accessToken, roles]);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      const session = await signIn(email, password);
      setAccessToken(session.accessToken);
      const staff = await getStaffRoles(session.accessToken);
      setRoles(staff.roles);
      // A link to an area opens it once the account is known to be allowed it.
      const first = areaFromSearch(window.location.search, staff.roles) ?? initialArea(staff.roles);
      if (first) openArea(first, 'replace');
    });
  };

  const signOut = () => {
    clearStaffSession();
    setAccessToken(undefined);
    setRoles([]);
    setArea(undefined);
    setPassword('');
    setError(undefined);
    setNotice(undefined);
    setMenuOpen(false);
  };

  const visible = permittedAreas(roles);
  const current = AREAS.find((definition) => definition.key === area);

  if (!accessToken)
    return (
      <div className="rs-auth">
        <main id="main" className="rs-auth__main">
          <p className="rs-brand">TURFR Operations</p>
          <PageHeader title="Operations" description={PRIVACY_STATEMENT} />
          <Section title="Sign in to review" description="Staff authentication.">
            <form className="rs-form rs-auth__form" onSubmit={handleSignIn}>
              <Field label="Email">
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>
              <div>
                <Button type="submit" busy={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>
              </div>
            </form>
            {error ? <Notice tone="danger">{error}</Notice> : null}
          </Section>
        </main>
        <footer className="rs-footer">
          {AUDIT_NOTICE} Territory capture remains off.
          <ThemeSwitch />
        </footer>
      </div>
    );

  const render = area ? AREA_VIEWS[area] : undefined;

  return (
    <div className="rs-app" data-menu-open={menuOpen}>
      <a className="rs-skip" href="#main">
        Skip to content
      </a>
      <div className="rs-topbar">
        <button
          type="button"
          className="rs-menu-button"
          aria-expanded={menuOpen}
          aria-controls="rs-sidebar"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Menu
        </button>
        <span className="rs-brand">TURFR Operations</span>
      </div>

      <aside id="rs-sidebar" className="rs-sidebar">
        <p className="rs-brand rs-sidebar__brand">TURFR Operations</p>
        <nav aria-label="Operations areas">
          {AREA_GROUPS.map((group) => {
            const items = visible.filter((definition) => definition.group === group.key);
            if (!items.length) return null;
            return (
              <div key={group.key} role="group" aria-label={group.label} className="rs-nav-group">
                <p className="rs-nav-group__label" aria-hidden>
                  {group.label}
                </p>
                {items.map((definition) => (
                  <button
                    key={definition.key}
                    type="button"
                    aria-current={definition.key === area}
                    onClick={() => openArea(definition.key)}
                  >
                    {definition.title}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="rs-session">
          <AccountMenu roles={roleLabels(roles)} onSignOut={signOut} />
        </div>
      </aside>

      <div className="rs-content">
        <main id="main" tabIndex={-1} className="rs-main">
          <PageHeader
            eyebrow="Operations"
            title={current?.title ?? 'Operations'}
            description={current?.summary}
          />

          {!visible.length ? <Notice tone="danger">{NO_ROLES_MESSAGE}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {notice ? <Notice tone="success">{notice}</Notice> : null}

          {current?.unbuiltReason ? (
            <Section title={current.title} description={current.unbuiltReason}>
              <StatusTag tone="warning">Not built yet</StatusTag>
              <Notice tone="readonly">{current.roleNote}</Notice>
            </Section>
          ) : null}

          {accessToken && area && render ? render({ accessToken, roles, loading, run }) : null}
        </main>
        <footer className="rs-footer">
          <span>
            {PRIVACY_STATEMENT} {AUDIT_NOTICE} Territory capture remains off.
          </span>
        </footer>
      </div>
    </div>
  );
}
