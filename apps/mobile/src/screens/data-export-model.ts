import type { AccountExportResponse } from '@runsphere/contracts';

/**
 * Settings → Data → Export your data. The privacy notice promises you can see
 * and download what we hold (DPDP Act s.11), so the app hands the export to
 * the phone's share sheet as readable JSON: save it to Drive or Files, email
 * it to yourself, or open it in a notes app. Built-in `Share` needs no extra
 * native module, and runs are summaries, so the text stays small.
 */
export const EXPORT_SHARE_TITLE = 'Your TURFR data';
export const EXPORT_FAILED_TITLE = 'Couldn’t get your data';
export const EXPORT_FAILED = 'Check your connection and try again.';

export const exportShareText = (result: AccountExportResponse): string =>
  JSON.stringify({ ...result, app: 'TURFR' }, null, 2);
