import type { LegalPage } from '@runsphere/domain';

/**
 * The legal pages the app links to from Settings and sign-up (M8 C.2). Google
 * Play wants the privacy policy reachable inside the app, not only on the store
 * listing. The pages are served by the API, so a build without an API address
 * has nothing to link to and shows no rows.
 */
export interface LegalLink {
  page: LegalPage;
  label: string;
  value: string;
  url: string;
}

const LINKS: readonly Omit<LegalLink, 'url'>[] = [
  { page: 'privacy', label: 'Privacy notice', value: 'What we keep and why' },
  { page: 'terms', label: 'Terms of use', value: 'The rules of the app' },
  { page: 'communityGuidelines', label: 'Community guidelines', value: 'How we treat each other' }
];

export const legalLinks = (urlFor: (page: LegalPage) => string | undefined): LegalLink[] =>
  LINKS.flatMap((link) => {
    const url = urlFor(link.page);
    return url ? [{ ...link, url }] : [];
  });

/** The line under the sign-up button, above the three links. */
export const SIGN_UP_AGREEMENT =
  'Creating an account means you accept the terms and community guidelines. The privacy notice says what we keep and why.';
