import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AccountMenu,
  Button,
  ConfirmButton,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Section,
  StatusTag,
  ThemeSwitch
} from './index.js';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('Button', () => {
  it('does not submit a form unless it is told to', () => {
    expect(html(<Button>Save</Button>)).toContain('type="button"');
    expect(html(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });

  it('is disabled and announced busy while work is in flight', () => {
    const markup = html(<Button busy>Saving…</Button>);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
    expect(html(<Button>Save</Button>)).not.toContain('aria-busy');
  });

  it('carries its variant', () => {
    expect(html(<Button variant="danger">Lift</Button>)).toContain('rs-btn--danger');
  });
});

describe('StatusTag and Notice', () => {
  it('keeps the meaning in the words, not the colour', () => {
    expect(html(<StatusTag tone="warning">Needs a look</StatusTag>)).toContain('Needs a look');
  });

  it('announces a danger notice and leaves the rest as notes', () => {
    expect(html(<Notice tone="danger">Could not save.</Notice>)).toContain('role="alert"');
    expect(html(<Notice tone="readonly">Read-only.</Notice>)).toContain('role="note"');
  });
});

describe('page structure', () => {
  it('has one h1 in the page header and a named section', () => {
    const markup = html(
      <>
        <PageHeader eyebrow="Operations" title="Quests" description="Set time limits." />
        <Section title="All quests">
          <p>Body</p>
        </Section>
      </>
    );
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toMatch(/<section[^>]*aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(markup)![1]!;
    expect(markup).toContain(`<h2 id="${id}"`);
  });

  it('says what is missing and offers the way forward', () => {
    const markup = html(
      <EmptyState title="Nothing to review" action={<Button>Refresh</Button>}>
        Every submission has been checked.
      </EmptyState>
    );
    expect(markup).toContain('Nothing to review');
    expect(markup).toContain('Refresh');
  });
});

describe('Field', () => {
  it('wraps the control in its label so they are always associated', () => {
    const markup = html(
      <Field label="Email" hint="Staff address" error="Required">
        <input type="email" />
      </Field>
    );
    expect(markup).toMatch(/^<label[^>]*>.*<input[^>]*>.*<\/label>$/);
    expect(markup).toContain('Staff address');
    expect(markup).toContain('Required');
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', header: 'Name', render: (row: { name: string; km: number }) => row.name },
    {
      key: 'km',
      header: 'Distance',
      numeric: true,
      render: (row: { name: string; km: number }) => `${row.km} km`
    }
  ];

  it('renders a captioned table with scoped headers and aligned numbers', () => {
    const markup = html(
      <DataTable
        caption="Quests"
        columns={columns}
        rows={[{ name: 'Carter Road', km: 3.2 }]}
        rowKey={(row) => row.name}
        emptyMessage="No quests."
      />
    );
    expect(markup).toContain('<caption class="rs-visually-hidden">Quests</caption>');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('Carter Road');
    expect(markup).toContain('class="rs-table__num"');
    expect(markup).toContain('tabindex="0"');
  });

  it('spans the whole table with one empty row', () => {
    const markup = html(
      <DataTable
        caption="Quests"
        columns={columns}
        rows={[]}
        rowKey={(row: { name: string }) => row.name}
        emptyMessage="No quests."
      />
    );
    expect(markup).toContain('colSpan="2"');
    expect(markup).toContain('No quests.');
  });
});

describe('Dialog', () => {
  it('is named by its own title and has a labelled close button', () => {
    const markup = html(
      <Dialog open={false} title="Lift sanction" onClose={() => undefined}>
        Reason
      </Dialog>
    );
    const id = /aria-labelledby="([^"]+)"/.exec(markup)![1]!;
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('aria-label="Close"');
  });
});

describe('ThemeSwitch', () => {
  it('offers Light, Dark and Match device, with light selected by default', () => {
    const markup = html(<ThemeSwitch />);
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toMatch(/aria-checked="true"[^>]*>Light</);
    expect(markup).toContain('>Dark<');
    expect(markup).toContain('>Match device<');
  });
});

describe('ConfirmButton', () => {
  it('shows the trigger and keeps the confirmation dialog closed until pressed', () => {
    const markup = html(
      <ConfirmButton
        title="Overturn this sanction?"
        description="The sanction is lifted now."
        confirmLabel="Overturn it"
        onConfirm={() => undefined}
      >
        Overturn it
      </ConfirmButton>
    );
    expect(markup).toContain('Overturn it');
    expect(markup).toContain('aria-labelledby');
    expect(markup).not.toMatch(/<dialog[^>]* open/);
  });
});

describe('AccountMenu', () => {
  it('names the account and its roles on the trigger', () => {
    const markup = html(<AccountMenu roles={['Admin', 'Support']} onSignOut={() => undefined} />);
    expect(markup).toContain('aria-label="Account"');
    expect(markup).toContain('Admin, Support');
  });
});
