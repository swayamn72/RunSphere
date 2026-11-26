/**
 * The legal documents the API publishes and the app links to (M8 C.2).
 *
 * One version string covers all three, because sign-up records a single
 * `policyVersion` in `consent_history`. Bump it whenever any document's text
 * changes, so a consent record always names the exact text that was shown.
 * A `-draft` suffix makes the pages show a draft banner. The owner published
 * 2026-11-26 as the live text for launch; the lawyer review (C.7) follows, and
 * any change it brings is a new version that existing runners re-accept.
 */
// 2026-11-22b: others may see your runs and routes per your settings (M9 9.26, ADR-0015).
// 2026-11-26: friend board and Ghost Races named, what the export covers, processors and
// courts from config, app labels corrected. Published (no longer a draft) for launch.
export const LEGAL_POLICY_VERSION = '2026-11-26';

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
