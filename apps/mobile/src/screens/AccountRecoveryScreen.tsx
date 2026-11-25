import { useState } from 'react';
import { View } from 'react-native';
import { Text, TextInput } from '../components/Text';
import type { MobileApiClient } from '../api-client';
import { BackHeader, PrimaryButton } from '../components/primitives';
import { useAppStyles } from '../components/styles';
import { useAppTheme } from '../theme/theme';
import {
  BAD_LINK_NOTICE,
  EMAIL_CHANGE_REQUESTED_NOTICE,
  RESET_REQUESTED_NOTICE,
  emailChangeFailureMessage,
  passwordProblem,
  resetFailureMessage,
  tokenFromPasted,
  validEmail
} from './account-recovery-model';

type Api = Pick<
  MobileApiClient,
  'requestPasswordReset' | 'completePasswordReset' | 'requestEmailChange' | 'completeEmailChange'
>;

export type RecoveryKind = 'forgot-password' | 'change-email';

/**
 * Forgot password and change email (M3.5). Two steps each: ask for the email,
 * then paste the link (or its code) from it. The emailed link points at a web
 * page that isn't built yet (M3.4), so pasting is the way back into the app.
 */
export function AccountRecoveryScreen({
  api,
  kind,
  initialEmail = '',
  onBack,
  onDone
}: {
  api: Api;
  kind: RecoveryKind;
  initialEmail?: string;
  onBack: () => void;
  /** Called after the reset or change completes; the caller decides where next. */
  onDone: () => void;
}) {
  const styles = useAppStyles();
  const { tokens } = useAppTheme();
  const forgot = kind === 'forgot-password';
  const [step, setStep] = useState<'ask' | 'finish'>('ask');
  const [email, setEmail] = useState(initialEmail);
  const [pasted, setPasted] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    setBusy(true);
    try {
      if (forgot) await api.requestPasswordReset(email.trim());
      else await api.requestEmailChange(email.trim());
      setNotice(forgot ? RESET_REQUESTED_NOTICE : EMAIL_CHANGE_REQUESTED_NOTICE);
      setStep('finish');
    } catch (error) {
      setNotice(forgot ? resetFailureMessage(error) : emailChangeFailureMessage(error));
    }
    setBusy(false);
  };

  const finish = async () => {
    const token = tokenFromPasted(pasted);
    if (!token) {
      setNotice(BAD_LINK_NOTICE);
      return;
    }
    if (forgot) {
      const problem = passwordProblem(password, confirm);
      if (problem) {
        setNotice(problem);
        return;
      }
    }
    setBusy(true);
    try {
      if (forgot) await api.completePasswordReset(token, password);
      else await api.completeEmailChange(token);
      onDone();
    } catch (error) {
      setNotice(forgot ? resetFailureMessage(error) : emailChangeFailureMessage(error));
    }
    setBusy(false);
  };

  const input = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: { placeholder: string; secure?: boolean; email?: boolean }
  ) => (
    <>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={options.email ? 'email-address' : 'default'}
        secureTextEntry={options.secure ?? false}
        onChangeText={onChange}
        placeholder={options.placeholder}
        placeholderTextColor={tokens.text.secondary}
        style={styles.input}
        value={value}
      />
    </>
  );

  return (
    <View>
      <BackHeader label={forgot ? 'SIGN IN' : 'SETTINGS'} onBack={onBack} />
      <Text style={styles.homeTitle}>{forgot ? 'Forgot your password?' : 'Change your email'}</Text>
      {step === 'ask' ? (
        <>
          <Text style={styles.lead}>
            {forgot
              ? "Enter your email and we'll send a link to set a new password."
              : "Enter your new email. We'll send a link there to confirm it."}
          </Text>
          {input(forgot ? 'Your email' : 'New email', email, setEmail, {
            placeholder: 'you@example.com',
            email: true
          })}
          <PrimaryButton
            label={busy ? 'Sending…' : 'Send link'}
            disabled={busy || !validEmail(email)}
            onPress={() => void ask()}
          />
        </>
      ) : (
        <>
          <Text style={styles.lead}>
            {forgot
              ? 'Paste the link from the email, then choose a new password.'
              : 'Paste the link from the email to finish.'}
          </Text>
          {input('Link or code from the email', pasted, setPasted, {
            placeholder: 'Paste it here'
          })}
          {forgot && (
            <>
              {input('New password', password, setPassword, {
                placeholder: 'At least 12 characters',
                secure: true
              })}
              {input('Confirm new password', confirm, setConfirm, {
                placeholder: 'Type it again',
                secure: true
              })}
            </>
          )}
          <PrimaryButton
            label={busy ? 'Saving…' : forgot ? 'Set new password' : 'Confirm new email'}
            disabled={busy || pasted.trim() === ''}
            onPress={() => void finish()}
          />
        </>
      )}
      {notice !== '' && (
        <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
          {notice}
        </Text>
      )}
    </View>
  );
}
