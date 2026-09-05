import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminShell } from './shell.js';

describe('admin shell', () => {
  const markup = () => renderToStaticMarkup(<AdminShell />);

  it('asks for a staff sign-in before showing any area', () => {
    const rendered = markup();

    expect(rendered).toContain('Sign in to review');
    // Nothing operational is rendered to an unauthenticated visitor: no queue,
    // no navigation, no area names.
    expect(rendered).not.toContain('Operations areas');
    expect(rendered).not.toContain('Moderation');
    expect(rendered).not.toContain('Campaign email');
  });

  it('names the console rather than one of its areas before an area is open', () => {
    // The console is more than the activity review queue it began as, and the
    // heading now becomes the area's own title once one is opened.
    expect(markup()).toContain('<h1>Operations</h1>');
  });

  it('states what staff cannot see here, and that their own use is recorded', () => {
    const rendered = markup();

    expect(rendered).toContain('Raw GPS, account contact details, and territory controls are');
    expect(rendered).toContain('recorded against your staff account');
    expect(rendered).toContain('Territory remains off.');
  });

  it('renders no operational data of its own', () => {
    const rendered = markup();

    expect(rendered).not.toContain('Riverside Rings');
    expect(rendered).not.toContain('Demo member');
    expect(rendered).not.toContain('@');
  });
});
