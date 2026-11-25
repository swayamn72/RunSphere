import { useState } from 'react';
import { Pressable } from 'react-native';
import { Text } from './Text';
import type { ReportReason, ReportSubjectType } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import {
  REPORT_ACKNOWLEDGED_NOTICE,
  REPORT_CONSEQUENCE_HINT,
  REPORT_REASONS_IN_ORDER,
  REPORT_REASON_LABEL,
  reportFailureNotice
} from '../screens/moderation-model';
import { SettingsGroup } from './primitives';
import { useAppStyles } from './styles';

export interface ReportSubject {
  type: ReportSubjectType;
  id: string;
  nameLabel: string;
}

/**
 * Pick a reason and send a report (M8 C.9). Google Play's user-generated
 * content policy wants reporting wherever other people's names and content
 * appear, so this is shared by Friends, runner profiles and clubs. The answer
 * is the same acknowledgement whatever happens next: the reporter is never
 * told the outcome for someone else's account.
 */
export function ReportPanel({
  api,
  subject,
  onFinished,
  onCancel
}: {
  api: Pick<MobileApiClient, 'fileReport'>;
  subject: ReportSubject;
  /** Called with the line to show once the report is sent or has failed. */
  onFinished: (notice: string, sent: boolean) => void;
  onCancel: () => void;
}) {
  const styles = useAppStyles();
  const [busy, setBusy] = useState(false);

  const send = async (reason: ReportReason) => {
    setBusy(true);
    try {
      await api.fileReport(subject.type, subject.id, reason);
      onFinished(REPORT_ACKNOWLEDGED_NOTICE, true);
    } catch (error) {
      onFinished(reportFailureNotice(error), false);
    }
    setBusy(false);
  };

  return (
    <SettingsGroup title={`Report ${subject.nameLabel}`}>
      <Text style={styles.settingsHint}>{REPORT_CONSEQUENCE_HINT}</Text>
      {REPORT_REASONS_IN_ORDER.map((reason) => (
        <Pressable
          key={reason}
          accessibilityRole="button"
          accessibilityLabel={`Report for ${REPORT_REASON_LABEL[reason]}`}
          disabled={busy}
          onPress={() => void send(reason)}
        >
          <Text style={styles.rowTitle}>{REPORT_REASON_LABEL[reason]}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel the report"
        onPress={onCancel}
      >
        <Text style={styles.textButton}>Cancel</Text>
      </Pressable>
    </SettingsGroup>
  );
}
