import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adminShellModel } from './model.js';
import { AdminShell } from './shell.js';

describe('admin shell', () => {
  it('renders the m0 operations model and quest catalogue', () => {
    const markup = renderToStaticMarkup(<AdminShell />);
    expect(adminShellModel.monthlyInfraBudgetInr).toBe(3000);
    expect(markup).toContain('MONTHLY INFRASTRUCTURE BUDGET');
    expect(markup).toContain('Riverside Rings');
    expect(markup).toContain('Demo member: Maya');
  });
});
