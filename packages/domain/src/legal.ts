/**
 * The legal documents the API publishes and the app links to (M8 C.2).
 *
 * One version string covers all three, because sign-up records a single
 * `policyVersion` in `consent_history`. Bump it whenever any document's text
 * changes, so a consent record always names the exact text that was shown.
 * The `-draft` suffix stays until the owner's lawyer has approved the text
 * (C.7); the pages show a draft banner while it is there.
 */
export const LEGAL_POLICY_VERSION = '2026-11-22-draft';

export const LEGAL_PAGES = {
  privacy: '/privacy',
  terms: '/terms',
  communityGuidelines: '/community-guidelines'
} as const;

export type LegalPage = keyof typeof LEGAL_PAGES;

export const isDraftPolicy = (version: string = LEGAL_POLICY_VERSION): boolean =>
  version.endsWith('-draft');

/** The public address of a legal page, under the API origin the app already uses. */
export const legalPageUrl = (apiBaseUrl: string, page: LegalPage): string =>
  `${apiBaseUrl.replace(/\/+$/, '')}${LEGAL_PAGES[page]}`;
