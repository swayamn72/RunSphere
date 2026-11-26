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

/**
 * The sign-up checkbox, above Create account, with the three links under it.
 * Ticking it is the runner's clear yes (DPDP s.6), rather than agreement
 * implied by tapping the button.
 */
export const SIGN_UP_AGREEMENT =
  'I agree to the terms of use and community guidelines, and I’ve read the privacy notice.';
