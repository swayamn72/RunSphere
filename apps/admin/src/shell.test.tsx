import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminShell } from './shell.js';

describe('admin shell', () => {
  it('renders an authenticated staff review screen without static operational data', () => {
    const markup = renderToStaticMarkup(<AdminShell />);

    expect(markup).toContain('Activity review');
    expect(markup).toContain('Sign in to review');
    expect(markup).toContain('Territory remains off.');
    expect(markup).not.toContain('Riverside Rings');
    expect(markup).not.toContain('Demo member');
  });
});
