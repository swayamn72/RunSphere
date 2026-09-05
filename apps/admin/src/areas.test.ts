import { describe, expect, it } from 'vitest';
import {
  AREAS,
  AUDIT_NOTICE,
  CONCENTRATION_NOTE,
  CONCENTRATION_NOT_APPLICABLE_NOTE,
  NO_ROLES_MESSAGE,
  OPEN_APPEAL_WARNING,
  PRIVACY_ATTENTION_HOURS,
  PRIVACY_READ_ONLY_NOTE,
  ROLLBACK_NOTE,
  ROLLBACK_REASON_HINT,
  RULES_READ_ONLY_NOTE,
  SANCTION_CHOICES,
  SANCTION_LIFT_HINT,
  SANCTION_STATEMENT_HINT,
  initialArea,
  permittedAreas,
  privacyNeedsAttention,
  roleLabels,
  sanctionLiftable
} from './areas.js';

describe('what each role can open', () => {
  it('shows a moderator moderation, and not competitions or campaigns', () => {
    const keys = permittedAreas(['moderator']).map((area) => area.key);

    expect(keys).toContain('moderation');
    expect(keys).not.toContain('competitions');
    expect(keys).not.toContain('campaigns');
  });

  it('shows a season operator competitions and seasons only', () => {
    const keys = permittedAreas(['season_operator']).map((area) => area.key);

    // The same role runs both, and the API gates them with the same predicate.
    expect(keys).toContain('competitions');
    expect(keys).toContain('seasons');
    expect(keys).not.toContain('moderation');
    expect(keys).not.toContain('campaigns');
  });

  it('shows a campaign manager campaigns only', () => {
    const keys = permittedAreas(['campaign_manager']).map((area) => area.key);

    expect(keys).toContain('campaigns');
    expect(keys).not.toContain('moderation');
    expect(keys).not.toContain('competitions');
  });

  it('shows an admin everything', () => {
    expect(permittedAreas(['admin'])).toHaveLength(AREAS.length);
  });

  it('gives an account with no staff role nothing but an explanation', () => {
    // Activity review is allow-listed by account id rather than by role, so
    // it is the one area offered to any signed-in staff account.
    expect(permittedAreas([]).map((area) => area.key)).toEqual(['review']);
    expect(NO_ROLES_MESSAGE).toContain('no staff role');
  });

  it('combines roles rather than picking one', () => {
    const keys = permittedAreas(['moderator', 'campaign_manager']).map((area) => area.key);

    expect(keys).toContain('moderation');
    expect(keys).toContain('campaigns');
    expect(keys).not.toContain('competitions');
  });
});

describe('where somebody lands', () => {
  it('opens the first area they can actually use', () => {
    expect(initialArea(['moderator'])).toBe('review');
    expect(initialArea(['campaign_manager'])).toBe('review');
  });

  it('never opens an area that has no route behind it', () => {
    const landing = initialArea(['support']);
    const area = AREAS.find((definition) => definition.key === landing);

    // Support's own area is not built; they land on something that works
    // rather than on an apology.
    expect(area?.unbuiltReason).toBeUndefined();
  });
});

describe('areas that do not exist yet', () => {
  it('name a reason rather than rendering an empty screen', () => {
    const unbuilt = AREAS.filter((area) => area.unbuiltReason);

    // Privacy and data stewardship gained routes in 3.12; support is the one
    // area still waiting, and it is waiting on a privacy review rather than on
    // somebody finding time.
    expect(unbuilt.map((area) => area.key)).toEqual(['support']);
    for (const area of unbuilt) {
      expect(area.unbuiltReason?.length ?? 0).toBeGreaterThan(40);
      // The reason says what is missing, not merely that something is.
      expect(area.unbuiltReason).toMatch(/no staff route exists/i);
    }
  });

  it('says why a support console needs a privacy review first', () => {
    const support = AREAS.find((area) => area.key === 'support');

    expect(support?.unbuiltReason).toContain('privacy review');
  });
});

describe('what the console tells the person using it', () => {
  it('names the role each gate matches, so it can be checked against the route', () => {
    for (const area of AREAS) expect(area.roleNote.length).toBeGreaterThan(10);
    expect(AREAS.find((area) => area.key === 'moderation')?.roleNote).toContain(
      '/v1/staff/reports'
    );
    // Activity review predates RBAC; the note says so rather than implying a role.
    expect(AREAS.find((area) => area.key === 'review')?.roleNote).toContain('account id');
    expect(AREAS.find((area) => area.key === 'privacy')?.roleNote).toContain(
      '/v1/staff/privacy/requests'
    );
    expect(AREAS.find((area) => area.key === 'data')?.roleNote).toContain('/v1/staff/rules');
  });

  it('tells staff their own use is recorded', () => {
    expect(AUDIT_NOTICE).toContain('recorded against your staff account');
  });

  it('names roles in words rather than showing the stored keys', () => {
    expect(roleLabels(['season_operator', 'admin'])).toEqual(['Admin', 'Season operator']);
    // A role granted later still reads as itself rather than disappearing.
    expect(roleLabels(['future_role'])).toEqual(['future_role']);
  });
});

describe('issuing and lifting a sanction', () => {
  it('describes each choice by what it actually does', () => {
    const choices = Object.fromEntries(
      SANCTION_CHOICES.map((choice) => [choice.kind, choice.effect])
    );

    expect(choices.warning).toContain('Changes nothing');
    // The one thing a moderator must not get wrong: a sharing pause does not
    // take somebody's own data away.
    expect(choices.social_suspension).toContain('Recording, history, and export are untouched');
    expect(choices.account_suspension).toContain('cannot sign in');
  });

  it('offers the choices in ascending severity', () => {
    expect(SANCTION_CHOICES.map((choice) => choice.kind)).toEqual([
      'warning',
      'social_suspension',
      'account_suspension'
    ]);
  });

  it('says the statement is the whole of what the account is told', () => {
    expect(SANCTION_STATEMENT_HINT).toContain('all they are told');
  });

  it('says the lift reason is for the record, not for the account', () => {
    expect(SANCTION_LIFT_HINT).toContain('The account is told the decision was lifted, not this');
  });

  it('offers a lift only while the sanction still applies', () => {
    expect(sanctionLiftable({ inForce: true })).toBe(true);
    expect(sanctionLiftable({ inForce: false })).toBe(false);
  });

  it('warns against lifting under an open appeal', () => {
    expect(OPEN_APPEAL_WARNING).toContain('Decide the appeal instead');
  });
});

describe('the governance areas', () => {
  it('says why both are read-only rather than leaving somebody hunting for a button', () => {
    expect(PRIVACY_READ_ONLY_NOTE).toContain('second way to destroy data');
    expect(RULES_READ_ONLY_NOTE).toContain('published by migration');
  });

  it('flags a request that has stopped moving', () => {
    expect(privacyNeedsAttention({ openForHours: PRIVACY_ATTENTION_HOURS - 1 })).toBe(false);
    expect(privacyNeedsAttention({ openForHours: PRIVACY_ATTENTION_HOURS })).toBe(true);
    // Not a legal deadline — the point at which a human should look.
    expect(PRIVACY_ATTENTION_HOURS).toBe(48);
  });

  it('opens both areas for the roles that own them', () => {
    expect(permittedAreas(['privacy_officer']).map((area) => area.key)).toContain('privacy');
    expect(permittedAreas(['data_steward']).map((area) => area.key)).toContain('data');
    // Neither role reaches the other's area.
    expect(permittedAreas(['privacy_officer']).map((area) => area.key)).not.toContain('data');
    expect(permittedAreas(['data_steward']).map((area) => area.key)).not.toContain('privacy');
  });
});

describe('the territory seasons area', () => {
  const seasons = AREAS.find((area) => area.key === 'seasons');

  it('is built, so it does not carry an unbuilt reason', () => {
    expect(seasons?.unbuiltReason).toBeUndefined();
    expect(seasons?.roleNote).toContain('/v1/staff/territory/seasons');
  });

  it('states the concentration limits an operator is watching', () => {
    // The numbers matter less here than the sentence: what the limit is, and
    // what happens when it is missed for a week.
    expect(CONCENTRATION_NOTE).toContain('35%');
    expect(CONCENTRATION_NOTE).toContain('8%');
    expect(CONCENTRATION_NOTE).toContain('Seven consecutive breached days');
  });

  it('separates a division too small to judge from one that is concentrated', () => {
    expect(CONCENTRATION_NOT_APPLICABLE_NOTE).toContain('merge it at the next season start');
    expect(CONCENTRATION_NOT_APPLICABLE_NOTE).not.toContain('breach');
  });

  it('says a rollback edits nothing before somebody asks for a button that would', () => {
    expect(ROLLBACK_NOTE).toContain('No snapshot is edited or deleted');
    expect(ROLLBACK_NOTE).toContain('rolling forward is a recomputation');
    expect(ROLLBACK_REASON_HINT).toContain('why its numbers changed');
  });
});
