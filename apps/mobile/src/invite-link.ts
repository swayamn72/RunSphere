/**
 * Friend invite links (ADR-0014, SI.3): `runsphere://invite/<token>`. The
 * token is the server's; the app only reads it out of the link and hands it
 * back, so anything that isn't exactly this shape is ignored.
 */
export const inviteTokenFromUrl = (url: string | null | undefined): string | undefined =>
  /^runsphere:\/\/invite\/([A-Za-z0-9_-]{20,64})\/?$/.exec(url?.trim() ?? '')?.[1];
