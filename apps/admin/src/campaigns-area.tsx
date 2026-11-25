import { useState } from 'react';
import type { CampaignSummary, EmailTemplate } from '@runsphere/contracts';
import {
  cancelCampaign,
  createCampaign,
  getCampaigns,
  getEmailTemplates,
  publishEmailTemplate,
  scheduleCampaign
} from './api.js';
import type { AreaContext } from './area-types.js';
import { lifecycleTone } from './status-tone.js';
import { useAreaLoad } from './use-area-load.js';
import {
  Button,
  ConfirmButton,
  DataTable,
  Field,
  FormDialog,
  Notice,
  Section,
  StatusTag
} from './ui/index.js';

/** Campaigns and the approved templates they send; both forms open in dialogs. */
export function CampaignsView({
  accessToken,
  campaigns,
  templates,
  loading,
  error,
  onChanged,
  run
}: AreaContext & {
  campaigns: readonly CampaignSummary[];
  templates: readonly EmailTemplate[];
  onChanged: () => void;
}) {
  const [templateKey, setTemplateKey] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [campaignTemplate, setCampaignTemplate] = useState('');
  const [sendCap, setSendCap] = useState('500');
  const [scheduledFor, setScheduledFor] = useState('');
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  return (
    <>
      <div className="rs-stack">
        <Section
          title="Campaigns"
          description="Consented sends. Every audience requires consent. You see counts here, never the people in them."
          actions={<Button onClick={() => setCreating(true)}>Create a campaign</Button>}
        >
          <DataTable
            caption="Campaigns"
            columns={[
              {
                key: 'template',
                header: 'Template',
                render: (c) => <strong>{c.templateKey}</strong>
              },
              {
                key: 'status',
                header: 'Status',
                render: (c) => <StatusTag tone={lifecycleTone(c.status)}>{c.status}</StatusTag>
              },
              { key: 'cap', header: 'Cap', numeric: true, render: (c) => c.sendCap },
              { key: 'queued', header: 'Queued', numeric: true, render: (c) => c.queuedCount },
              { key: 'sent', header: 'Sent', numeric: true, render: (c) => c.sentCount },
              {
                key: 'actions',
                header: 'Actions',
                render: (campaign) => (
                  <div className="rs-actions">
                    {campaign.status === 'draft' ? (
                      <>
                        <Field label="Send at">
                          <input
                            type="datetime-local"
                            value={scheduledFor}
                            onChange={(event) => setScheduledFor(event.target.value)}
                          />
                        </Field>
                        <Button
                          variant="secondary"
                          disabled={loading || !scheduledFor}
                          onClick={() =>
                            void run(
                              () =>
                                scheduleCampaign(
                                  accessToken,
                                  campaign.id,
                                  new Date(scheduledFor).toISOString()
                                ),
                              'Scheduled. It can still be cancelled until it sends.'
                            ).then(onChanged)
                          }
                        >
                          Schedule
                        </Button>
                      </>
                    ) : null}
                    {campaign.status !== 'sent' && campaign.status !== 'cancelled' ? (
                      <ConfirmButton
                        variant="ghost"
                        danger
                        disabled={loading}
                        title="Cancel this campaign?"
                        description="Anything still queued is dropped and nothing more is sent."
                        confirmLabel="Cancel the campaign"
                        onConfirm={() =>
                          void run(
                            () => cancelCampaign(accessToken, campaign.id),
                            'Cancelled. Anything still queued was dropped.'
                          ).then(onChanged)
                        }
                      >
                        Cancel
                      </ConfirmButton>
                    ) : null}
                  </div>
                )
              }
            ]}
            rows={campaigns}
            rowKey={(campaign) => campaign.id}
            emptyMessage={loading ? 'Loading…' : 'No campaigns yet.'}
          />
        </Section>

        <Section
          title="Approved copy"
          description="Templates, newest version first by key."
          actions={
            <Button variant="secondary" onClick={() => setPublishing(true)}>
              Publish a template
            </Button>
          }
        >
          <DataTable
            caption="Email templates"
            columns={[
              {
                key: 'key',
                header: 'Key',
                render: (t) => (
                  <>
                    <code>{t.key}</code>{' '}
                    {t.live ? <StatusTag tone="success">live</StatusTag> : null}
                  </>
                )
              },
              { key: 'version', header: 'Version', numeric: true, render: (t) => `v${t.version}` },
              { key: 'subject', header: 'Subject', render: (t) => t.subject }
            ]}
            rows={templates}
            rowKey={(template) => `${template.key}-${template.version}`}
            emptyMessage={loading ? 'Loading…' : 'No template has been published.'}
          />
        </Section>
      </div>

      <FormDialog
        open={creating}
        title="Create a campaign"
        submitLabel="Create draft"
        busy={loading}
        error={error}
        onClose={() => setCreating(false)}
        onSubmit={() =>
          void run(
            () =>
              createCampaign(accessToken, {
                templateKey: campaignTemplate,
                audience: { consentRequired: true },
                sendCap: Number(sendCap)
              }),
            'Draft created. Nothing has been sent.'
          ).then((ok) => {
            if (!ok) return;
            setCreating(false);
            setCampaignTemplate('');
            onChanged();
          })
        }
      >
        <Field label="Template key">
          <input
            value={campaignTemplate}
            onChange={(event) => setCampaignTemplate(event.target.value)}
            required
          />
        </Field>
        <Field label="Send cap">
          <input
            type="number"
            min={1}
            value={sendCap}
            onChange={(event) => setSendCap(event.target.value)}
            required
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={publishing}
        title="Publish a template"
        submitLabel="Publish version"
        busy={loading}
        error={error}
        onClose={() => setPublishing(false)}
        onSubmit={() =>
          void run(
            () => publishEmailTemplate(accessToken, { key: templateKey, subject, body }),
            'Template published. It is now the live version for that key.'
          ).then((ok) => {
            if (!ok) return;
            setPublishing(false);
            setTemplateKey('');
            setSubject('');
            setBody('');
            onChanged();
          })
        }
      >
        <Notice tone="readonly">
          Publishing a version is the approval. A new version supersedes the live one; a campaign
          already scheduled keeps the version it resolved.
        </Notice>
        <Field label="Key">
          <input
            value={templateKey}
            onChange={(event) => setTemplateKey(event.target.value)}
            required
          />
        </Field>
        <Field label="Subject">
          <input value={subject} onChange={(event) => setSubject(event.target.value)} required />
        </Field>
        <Field label="Body">
          <textarea value={body} onChange={(event) => setBody(event.target.value)} required />
        </Field>
      </FormDialog>
    </>
  );
}

export function CampaignsArea(context: AreaContext) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const reload = () =>
    context.run(async () => {
      setCampaigns((await getCampaigns(context.accessToken)).data);
      setTemplates((await getEmailTemplates(context.accessToken)).data);
    });
  useAreaLoad(reload);
  return (
    <CampaignsView
      {...context}
      campaigns={campaigns}
      templates={templates}
      onChanged={() => void reload()}
    />
  );
}
