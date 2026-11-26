import { afterEach, describe, expect, it } from 'vitest';
import { LEGAL_PAGES } from '@runsphere/domain';
import { buildApp } from './app.js';

/** M8 C.2: the privacy notice, terms and guidelines Play, DPDP and the IT Rules need. */

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const get = (url: string, config: Parameters<typeof buildApp>[0] = {}) => {
  const app = buildApp({ authSecret: 'legal-pages-test-secret', ...config });
  apps.push(app);
  return app.inject({ method: 'GET', url });
};

describe('legal pages', () => {
  it.each(Object.values(LEGAL_PAGES))(
    '%s is public, self-contained and marked as a draft',
    async (url) => {
      const response = await get(url);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.body).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      expect(response.body).toContain('<strong>Draft.</strong>');
      expect(response.body).toContain('Grievance officer');
    }
  );

  it('states the facts the code enforces', async () => {
    const privacy = (await get('/privacy')).body;

    expect(privacy).toContain('Raw GPS points from a run: 30 days');
    expect(privacy).toContain('we keep only the fact that the check passed');
    expect(privacy).toContain('at least 500 m across');
    expect(privacy).toContain('Data Protection Board of India');
    expect(privacy).toContain('href="/account/delete"');
    // The app's own labels, so a runner can follow the steps.
    expect(privacy).toContain('tap Delete run');
    expect(privacy).toContain('Data and account → Export');
    expect(privacy).toContain('friend board');
    expect(privacy).toContain('Ghost Races');
  });

  it('names the processors and the courts from config', async () => {
    const config = {
      config: {
        legalContact: {
          hostingProvider: 'Example Cloud',
          emailProvider: 'Example Mail',
          courts: 'the courts at Mumbai'
        }
      }
    };
    const privacy = (await get('/privacy', config)).body;
    expect(privacy).toContain('Example Cloud');
    expect(privacy).toContain('Example Mail');
    expect((await get('/terms', config)).body).toContain('Disputes go to the courts at Mumbai.');
  });

  it('names the grievance officer from config, escaped', async () => {
    const response = await get('/terms', {
      config: {
        legalContact: {
          operatorName: 'RunSphere <Labs>',
          grievanceOfficerName: 'A. Officer',
          grievanceOfficerEmail: 'grievance@example.in'
        }
      }
    });

    expect(response.body).toContain('RunSphere &#60;Labs&#62;');
    expect(response.body).toContain('A. Officer');
    expect(response.body).toContain('href="mailto:grievance@example.in"');
    expect(response.body).not.toContain('<Labs>');
  });

  it('says plainly when nobody has been named yet', async () => {
    expect((await get('/privacy')).body).toContain('[to be named before launch]');
  });
});
