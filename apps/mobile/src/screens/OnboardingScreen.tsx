import { StatusBar } from 'expo-status-bar';
import { failureMessage } from '../failure-copy';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { AppState, Linking, Pressable, SafeAreaView, ScrollView, Switch, View } from 'react-native';
import { Text, TextInput } from '../components/Text';
import { useAppTheme } from '../theme/theme';
import { statusBarStyleFor } from '../theme/theme-state';
import type { MobileApiClient } from '../api-client';
import { AuthFailure } from '../auth-failure';
import { getLocationPermissionState } from '../location-permission';
import { accountFieldProblems, dateOfBirthFrom, signUpPasswordHint } from '../onboarding';
import { OnboardingSocialStep } from './OnboardingSocialStep';
import { AccountRecoveryScreen } from './AccountRecoveryScreen';
import { SIGN_UP_AGREEMENT, legalLinks } from './legal-model';
import { LEGAL_POLICY_VERSION, normalizeUsername } from '@runsphere/domain';
import type { AccountMode, initialOnboardingState, onboardingReducer } from '../onboarding';
import { PermissionCard, PrimaryButton, StepHeader } from '../components/primitives';
import { KeyboardSafe } from '../components/ScreenShell';
import { useAppStyles } from '../components/styles';

type AccountField = keyof ReturnType<typeof accountFieldProblems>;
type AccountUpdate = Extract<Parameters<typeof onboardingReducer>[1], { type: 'updateAccount' }>;

export function Onboarding({
  state,
  dispatch,
  api,
  onAuthenticated
}: {
  state: typeof initialOnboardingState;
  api: MobileApiClient;
  dispatch: React.Dispatch<Parameters<typeof onboardingReducer>[1]>;
  onAuthenticated: (session: Awaited<ReturnType<MobileApiClient['login']>>) => void;
}) {
  const styles = useAppStyles();
  const { colorScheme, tokens } = useAppTheme();
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<{
    message: string;
    field?: AccountField;
    kind?: AuthFailure['kind'];
  }>();
  const [showPassword, setShowPassword] = useState(false);
  const [checkedFields, setCheckedFields] = useState<Partial<Record<AccountField, boolean>>>({});
  /** Forgot password replaces the sign-in form until it's done or backed out of. */
  const [recovering, setRecovering] = useState(false);
  const legal = legalLinks((page) => api.legalPageUrl(page));

  /**
   * The start/finish switch used to stay on the phone and do nothing (M9 9.0).
   * The server defaults it off (ADR-0015), so only turning it on needs saving;
   * saving otherwise would also mark the privacy settings as reviewed, which
   * hides the one-time review prompt from an existing account signing in.
   */
  const finishOnboarding = () => {
    if (state.hideStartFinish)
      void api.savePrivacySettings({ trimStartFinish: true }).catch(() => undefined);
    dispatch({ type: 'finish' });
  };
  const [authNotice, setAuthNotice] = useState<string>();
  const registering = state.accountMode === 'register';
  const problems = accountFieldProblems(state);
  const firstProblem = Object.values(problems)[0];
  const checkField = (field: AccountField) =>
    setCheckedFields((previous) => ({ ...previous, [field]: true }));
  const updateField = (field: AccountField, update: Omit<AccountUpdate, 'type'>) => {
    if (authError?.field === field) setAuthError(undefined);
    dispatch({ type: 'updateAccount', ...update });
  };
  const openAccount = (mode: AccountMode) => {
    setAuthError(undefined);
    setAuthNotice(undefined);
    setShowPassword(false);
    setCheckedFields({});
    dispatch({ type: 'startAccount', mode });
  };
  const fieldMessage = (field: AccountField, hint?: string) => {
    const problem =
      authError?.field === field ? authError.message : checkedFields[field] && problems[field];
    if (!problem && !hint) return null;
    return (
      <Text
        accessibilityLiveRegion="polite"
        style={problem ? styles.accountFieldError : styles.rowDetail}
      >
        {problem || hint}
      </Text>
    );
  };
  const emailConflict = authError?.kind === 'account-exists';
  const submitDisabled = Boolean(firstProblem || loading || authError?.field);
  const authenticate = async () => {
    if (submitDisabled) return;
    setLoading(true);
    setAuthError(undefined);
    try {
      const session =
        state.accountMode === 'login'
          ? await api.login({ email: state.email.trim(), password: state.password })
          : await api.register({
              email: state.email.trim(),
              password: state.password,
              dateOfBirth: dateOfBirthFrom(state)!,
              username: normalizeUsername(state.username),
              policyVersion: LEGAL_POLICY_VERSION
            });
      onAuthenticated(session);
      // The name typed at sign-up becomes the display name. Best effort: the
      // username already stands in until it's saved.
      if (state.accountMode === 'register' && state.name.trim())
        await api.updateProfile({ displayName: state.name.trim() }).catch(() => undefined);
      dispatch({ type: 'authenticationSucceeded' });
    } catch (error) {
      if (error instanceof AuthFailure) {
        const field =
          error.registrationIssue?.field ??
          (error.kind === 'account-exists'
            ? 'email'
            : error.kind === 'username-taken'
              ? 'username'
              : undefined);
        const message =
          registering && error.kind === 'invalid-request' && !field
            ? "We couldn't create your account. Try again in a moment."
            : error.message;
        setAuthError({ message, ...(field ? { field } : {}), kind: error.kind });
      } else {
        setAuthError({
          message: failureMessage(
            error,
            registering
              ? "Couldn't create your account. Try again."
              : "Couldn't sign in. Try again."
          )
        });
      }
    } finally {
      setLoading(false);
    }
  };
  const reconcileLocationPermission = useCallback(async () => {
    const permission = await Location.getForegroundPermissionsAsync();
    dispatch({ type: 'setLocation', status: getLocationPermissionState(permission) });
    return permission;
  }, [dispatch]);
  const requestLocation = async () => {
    const currentPermission = await Location.getForegroundPermissionsAsync();
    const currentStatus = getLocationPermissionState(currentPermission);

    if (currentStatus === 'granted') {
      dispatch({ type: 'setLocation', status: 'granted' });
      return;
    }
    if (currentStatus === 'blocked') {
      dispatch({ type: 'setLocation', status: 'blocked' });
      await Linking.openSettings();
      return;
    }

    const requestedPermission = await Location.requestForegroundPermissionsAsync();
    dispatch({
      type: 'setLocation',
      status: getLocationPermissionState(requestedPermission)
    });
  };

  useEffect(() => {
    if (state.step !== 'privacy' && state.step !== 'location-denied') return;

    void reconcileLocationPermission();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void reconcileLocationPermission();
    });
    return () => subscription.remove();
  }, [reconcileLocationPermission, state.step]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={statusBarStyleFor(colorScheme)} />
      <KeyboardSafe>
        <ScrollView
          contentContainerStyle={styles.onboardingContent}
          keyboardShouldPersistTaps="handled"
        >
          {state.step === 'welcome' && (
            <>
              <View style={styles.splashMark}>
                <Text accessibilityRole="header" style={styles.wordmark}>
                  TURFR
                </Text>
                <Text style={styles.splashTagline}>Run a loop. Claim your ground.</Text>
              </View>
              <PrimaryButton label="Get started" onPress={() => openAccount('register')} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="I already have an account"
                onPress={() => openAccount('login')}
              >
                <Text style={styles.textButton}>I already have an account</Text>
              </Pressable>
            </>
          )}
          {state.step === 'account' && recovering && (
            <AccountRecoveryScreen
              api={api}
              kind="forgot-password"
              initialEmail={state.email}
              onBack={() => setRecovering(false)}
              onDone={() => {
                setRecovering(false);
                setAuthNotice('Password changed. Sign in with your new password.');
              }}
            />
          )}
          {state.step === 'account' && !recovering && (
            <>
              <StepHeader
                step={state.accountMode === 'login' ? 'SIGN IN' : 'STEP 1 OF 3'}
                onBack={() => {
                  if (!loading) dispatch({ type: 'back' });
                }}
              />
              <Text style={styles.wordmark}>TURFR</Text>
              <Text style={styles.eyebrow}>
                {state.accountMode === 'login' ? 'WELCOME BACK' : 'MAKE IT YOURS'}
              </Text>
              <Text style={styles.onboardingTitle}>
                {state.accountMode === 'login' ? 'Sign in securely.' : 'Create your account'}
              </Text>
              <Text style={styles.lead}>
                {state.accountMode === 'login'
                  ? 'Use your email and password to restore your private TURFR account.'
                  : 'Set up your private TURFR account.'}
              </Text>
              {state.accountMode === 'register' && (
                <>
                  <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
                  <TextInput
                    accessibilityLabel="Display name"
                    autoCapitalize="words"
                    editable={!loading}
                    value={state.name}
                    onBlur={() => checkField('name')}
                    onChangeText={(name) => dispatch({ type: 'updateAccount', name })}
                    placeholder="What should we call you?"
                    placeholderTextColor={tokens.text.secondary}
                    style={styles.input}
                  />
                  {fieldMessage('name')}
                  <Text style={styles.fieldLabel}>USERNAME</Text>
                  <TextInput
                    accessibilityLabel="Username"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!loading}
                    value={state.username}
                    onBlur={() => checkField('username')}
                    onChangeText={(username) => updateField('username', { username })}
                    placeholder="@username"
                    placeholderTextColor={tokens.text.secondary}
                    style={styles.input}
                  />
                  {fieldMessage(
                    'username',
                    'Use 3–20 letters, numbers or underscores. Start with a letter.'
                  )}
                  <Text style={styles.fieldLabel}>DATE OF BIRTH</Text>
                  <View style={styles.filterRow}>
                    <TextInput
                      accessibilityLabel="Day of birth"
                      keyboardType="number-pad"
                      maxLength={2}
                      editable={!loading}
                      value={state.birthDay}
                      onChangeText={(birthDay) => updateField('birthDate', { birthDay })}
                      placeholder="DD"
                      placeholderTextColor={tokens.text.secondary}
                      style={[styles.input, styles.flexCopy]}
                    />
                    <TextInput
                      accessibilityLabel="Month of birth"
                      keyboardType="number-pad"
                      maxLength={2}
                      editable={!loading}
                      value={state.birthMonth}
                      onChangeText={(birthMonth) => updateField('birthDate', { birthMonth })}
                      placeholder="MM"
                      placeholderTextColor={tokens.text.secondary}
                      style={[styles.input, styles.flexCopy]}
                    />
                    <TextInput
                      accessibilityLabel="Year of birth"
                      keyboardType="number-pad"
                      maxLength={4}
                      editable={!loading}
                      value={state.birthYear}
                      onBlur={() => checkField('birthDate')}
                      onChangeText={(birthYear) => updateField('birthDate', { birthYear })}
                      placeholder="YYYY"
                      placeholderTextColor={tokens.text.secondary}
                      style={[styles.input, styles.flexCopy]}
                    />
                  </View>
                  {fieldMessage(
                    'birthDate',
                    "Only to check you're 18 or older. Never shown to anyone."
                  )}
                </>
              )}
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!loading}
                keyboardType="email-address"
                value={state.email}
                onBlur={() => checkField('email')}
                onChangeText={(email) => updateField('email', { email })}
                placeholder="you@example.com"
                placeholderTextColor={tokens.text.secondary}
                style={styles.input}
              />
              {fieldMessage('email')}
              {emailConflict && (
                <Pressable accessibilityRole="button" onPress={() => openAccount('login')}>
                  <Text style={styles.textButton}>Sign in with this email</Text>
                </Pressable>
              )}
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  editable={!loading}
                  secureTextEntry={!showPassword}
                  value={state.password}
                  onBlur={() => checkField('password')}
                  onChangeText={(password) => updateField('password', { password })}
                  placeholder="Password"
                  placeholderTextColor={tokens.text.secondary}
                  style={[styles.input, styles.flexCopy]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  onPress={() => setShowPassword((visible) => !visible)}
                  style={styles.passwordToggle}
                >
                  <Text style={styles.textButton}>{showPassword ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>
              {fieldMessage('password', registering ? signUpPasswordHint : undefined)}
              {authNotice && !authError ? (
                <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
                  {authNotice}
                </Text>
              ) : null}
              {state.accountMode === 'login' && (
                <Pressable
                  accessibilityRole="button"
                  disabled={loading}
                  onPress={() => {
                    setAuthError(undefined);
                    setRecovering(true);
                  }}
                >
                  <Text style={styles.textButton}>Forgot password?</Text>
                </Pressable>
              )}
              {state.accountMode === 'register' && (
                <>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: state.acceptedLegal }}
                    accessibilityLabel={SIGN_UP_AGREEMENT}
                    disabled={loading}
                    onPress={() =>
                      dispatch({ type: 'setAcceptedLegal', value: !state.acceptedLegal })
                    }
                    style={styles.checkRow}
                  >
                    <View style={[styles.checkbox, state.acceptedLegal && styles.checkboxChecked]}>
                      {state.acceptedLegal ? <Text style={styles.checkMark}>✓</Text> : null}
                    </View>
                    <Text style={styles.checkCopy}>{SIGN_UP_AGREEMENT}</Text>
                  </Pressable>
                  {legal.map((link) => (
                    <Pressable
                      key={link.page}
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(link.url)}
                    >
                      <Text style={styles.textButton}>{link.label}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {(firstProblem || authError) && (
                <Text
                  accessibilityLiveRegion="polite"
                  style={authError ? styles.errorText : styles.rowDetail}
                >
                  {authError?.message ?? firstProblem}
                </Text>
              )}
              <PrimaryButton
                label={
                  loading
                    ? registering
                      ? 'Creating account…'
                      : 'Signing in…'
                    : registering
                      ? 'Create account'
                      : 'Sign in'
                }
                disabled={submitDisabled}
                onPress={() => void authenticate()}
              />
              <Pressable
                accessibilityRole="button"
                disabled={loading}
                onPress={() => openAccount(registering ? 'login' : 'register')}
              >
                <Text style={styles.textButton}>
                  {state.accountMode === 'login'
                    ? 'Need an account? Create one'
                    : 'Already have an account? Sign in'}
                </Text>
              </Pressable>
            </>
          )}
          {state.step === 'social' && (
            <OnboardingSocialStep
              api={api}
              captureLocation={async () => {
                const permission = await Location.requestForegroundPermissionsAsync();
                if (!permission.granted) return undefined;
                const position = await Location.getCurrentPositionAsync({
                  accuracy: Location.Accuracy.Balanced
                });
                return { latitude: position.coords.latitude, longitude: position.coords.longitude };
              }}
              onDone={() => dispatch({ type: 'socialDone' })}
            />
          )}
          {state.step === 'privacy' && (
            <>
              <StepHeader
                step={state.accountMode === 'login' ? 'STEP 2 OF 2' : 'STEP 3 OF 3'}
                onBack={() => dispatch({ type: 'back' })}
              />
              <View accessible={false} style={styles.miniMap}>
                <Text style={styles.mapRoute}>⌁</Text>
                <Text style={styles.mapShield}>✓</Text>
              </View>
              <Text style={styles.eyebrow}>YOU’RE IN CONTROL</Text>
              <Text style={styles.onboardingTitle}>Set up your run map.</Text>
              <Text style={styles.lead}>
                Precise location records your run. GPS points are encrypted on your phone, then sent
                to TURFR to check the run. The GPS points you send are kept for up to 30 days, and
                route maps are trimmed around your saved privacy zones.
              </Text>
              <PermissionCard
                icon="⌖"
                title="Precise location"
                detail="While you run; encrypted on your phone and sent only to check a saved run"
                badge="Required"
              />
              <PermissionCard
                icon="⌁"
                title="Track with the screen off"
                detail="During a run, a notification shows while TURFR records with your screen locked. It stops when you pause or finish."
                badge="During runs"
              />
              <View style={styles.privacyRow}>
                <View style={styles.flexCopy}>
                  <Text style={styles.rowTitle}>Hide start and finish</Text>
                  <Text style={styles.rowDetail}>
                    Others see your routes without the first and last 200 m. Your privacy zones are
                    always trimmed too.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Hide start and finish"
                  value={state.hideStartFinish}
                  onValueChange={(value) => dispatch({ type: 'setHideStartFinish', value })}
                  trackColor={{ false: tokens.border.subtle, true: tokens.status.success }}
                />
              </View>
              <Text style={styles.privateNote}>
                Change who sees your runs any time in Privacy & visibility. Declining location still
                lets you browse TURFR, but mapping runs and nearby quests won’t work.
              </Text>
              {state.location !== 'granted' ? (
                <PrimaryButton label="Allow location" onPress={() => void requestLocation()} />
              ) : (
                <>
                  <PrimaryButton label="Continue to TURFR" onPress={finishOnboarding} />
                </>
              )}
              {state.location !== 'granted' && (
                <Pressable accessibilityRole="button" onPress={finishOnboarding}>
                  <Text style={styles.textButton}>Continue without location</Text>
                </Pressable>
              )}
            </>
          )}
          {state.step === 'location-denied' && (
            <>
              <StepHeader step="LOCATION NEEDED" onBack={() => dispatch({ type: 'back' })} />
              <Text style={styles.eyebrow}>LOCATION IS OFF</Text>
              <Text style={styles.onboardingTitle}>You can keep browsing.</Text>
              <Text style={styles.lead}>
                Without location, TURFR can’t map your runs or show nearby quests. Background
                location is optional, and we only ask when you choose to track with the screen off.
              </Text>
              {state.location === 'blocked' && (
                <Text style={styles.privateNote}>
                  Location is disabled for TURFR. Enable it in Android Settings, then return here.
                </Text>
              )}
              <PrimaryButton
                label={
                  state.location === 'blocked' ? 'Open location settings' : 'Try location again'
                }
                onPress={() => void requestLocation()}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => dispatch({ type: 'continueWithoutLocation' })}
              >
                <Text style={styles.textButton}>Continue without run mapping</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}
