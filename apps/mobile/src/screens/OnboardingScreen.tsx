import { StatusBar } from 'expo-status-bar';
import { failureMessage } from '../failure-copy';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import {
  AppState,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { useAppTheme } from '../theme/theme';
import type { MobileApiClient } from '../api-client';
import { AuthFailure } from '../auth-failure';
import { getLocationPermissionState } from '../location-permission';
import { accountProblem, canSubmitAccount, dateOfBirthFrom } from '../onboarding';
import { OnboardingSocialStep } from './OnboardingSocialStep';
import { AccountRecoveryScreen } from './AccountRecoveryScreen';
import { usernameHint } from './privacy-settings-model';
import { SIGN_UP_AGREEMENT, legalLinks } from './legal-model';
import { LEGAL_POLICY_VERSION } from '@runsphere/domain';
import type { initialOnboardingState, onboardingReducer } from '../onboarding';
import { PermissionCard, PrimaryButton, StepHeader } from '../components/primitives';
import { KeyboardSafe } from '../components/ScreenShell';
import { useAppStyles } from '../components/styles';
import appLogo from '../../assets/logo.png';

type AuthStatus = 'idle' | 'loading' | 'error';

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
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
  const [authError, setAuthError] = useState<string>();
  const [authFailureKind, setAuthFailureKind] = useState<AuthFailure['kind']>();
  /** Forgot password replaces the sign-in form until it's done or backed out of. */
  const [recovering, setRecovering] = useState(false);
  const legal = legalLinks((page) => api.legalPageUrl(page));
  const [authNotice, setAuthNotice] = useState<string>();
  const authenticate = async () => {
    if (!canSubmitAccount(state)) return;
    setAuthStatus('loading');
    setAuthError(undefined);
    setAuthFailureKind(undefined);
    try {
      const session =
        state.accountMode === 'login'
          ? await api.login({ email: state.email.trim(), password: state.password })
          : await api.register({
              email: state.email.trim(),
              password: state.password,
              dateOfBirth: dateOfBirthFrom(state)!,
              username: state.username.trim().replace(/^@/, '').toLowerCase(),
              policyVersion: LEGAL_POLICY_VERSION
            });
      onAuthenticated(session);
      // The name typed at sign-up becomes the display name. Best effort: the
      // username already stands in until it's saved.
      if (state.accountMode === 'register' && state.name.trim())
        await api.updateProfile({ displayName: state.name.trim() }).catch(() => undefined);
      dispatch({ type: 'authenticationSucceeded' });
    } catch (error) {
      setAuthError(
        error instanceof AuthFailure
          ? error.message
          : failureMessage(error, "Couldn't sign in. Try again.")
      );
      setAuthFailureKind(error instanceof AuthFailure ? error.kind : 'unknown');
      setAuthStatus('error');
      return;
    }
    setAuthStatus('idle');
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

  const requestMotion = async () => {
    const permission = await Pedometer.requestPermissionsAsync();
    dispatch({ type: 'setMotion', status: permission.status === 'granted' ? 'granted' : 'denied' });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={colorScheme === 'dark' ? 'dark' : 'light'} />
      <KeyboardSafe>
        <ScrollView
          contentContainerStyle={styles.onboardingContent}
          keyboardShouldPersistTaps="handled"
        >
          {state.step === 'welcome' && (
            <>
              {/*
              The wordmark sits inside the hero rather than under it, so the
              first screen is one image with a name on it. Geometry rather than
              a photograph: the app ships no bitmap hero, and a stock runner
              would be the one thing on this screen that is not RunSphere's.
            */}
              <View accessible={false} style={styles.splashHero}>
                <View style={styles.orbitOne} />
                <View style={styles.orbitTwo} />
                <Image
                  source={appLogo}
                  style={styles.splashLogo}
                  resizeMode="contain"
                  accessibilityRole="image"
                  accessibilityLabel="RunSphere logo"
                />
                <View style={styles.splashMark}>
                  <Text accessibilityRole="header" style={styles.wordmark}>
                    Run<Text style={styles.teal}>Sphere</Text>
                  </Text>
                  <Text style={styles.splashTagline}>More than a run.{'\n'}A bigger world.</Text>
                </View>
              </View>
              <PrimaryButton
                label="Get started"
                onPress={() => dispatch({ type: 'startAccount', mode: 'register' })}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="I already have an account"
                onPress={() => dispatch({ type: 'startAccount', mode: 'login' })}
              >
                <Text style={styles.textButton}>I already have an account</Text>
              </Pressable>
              {/* The three verbs the product is built on, as the design closes
                the screen with. */}
              <Text style={styles.splashFooter}>Run · Capture · Connect</Text>
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
                onBack={() => dispatch({ type: 'back' })}
              />
              <Image
                source={appLogo}
                style={styles.accountLogo}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel="RunSphere logo"
              />
              <Text style={styles.eyebrow}>
                {state.accountMode === 'login' ? 'WELCOME BACK' : 'MAKE IT YOURS'}
              </Text>
              <Text style={styles.onboardingTitle}>
                {state.accountMode === 'login' ? 'Sign in securely.' : 'A few details first.'}
              </Text>
              <Text style={styles.lead}>
                {state.accountMode === 'login'
                  ? 'Use your email and password to restore your private RunSphere account.'
                  : 'We use your email and password to create your private RunSphere account.'}
              </Text>
              {state.accountMode === 'register' && (
                <>
                  <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
                  <TextInput
                    accessibilityLabel="Display name"
                    autoCapitalize="words"
                    value={state.name}
                    onChangeText={(name) => dispatch({ type: 'updateAccount', name })}
                    placeholder="How should we call you?"
                    placeholderTextColor={tokens.text.secondary}
                    style={styles.input}
                  />
                  <Text style={styles.fieldLabel}>USERNAME</Text>
                  <TextInput
                    accessibilityLabel="Username"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={state.username}
                    onChangeText={(username) => dispatch({ type: 'updateAccount', username })}
                    placeholder="@username"
                    placeholderTextColor={tokens.text.secondary}
                    style={styles.input}
                  />
                  {usernameHint(state.username) ? (
                    <Text style={styles.rowDetail}>{usernameHint(state.username)}</Text>
                  ) : (
                    <Text style={styles.rowDetail}>
                      How friends find you. You can change it later.
                    </Text>
                  )}
                  <Text style={styles.fieldLabel}>DATE OF BIRTH</Text>
                  <View style={styles.filterRow}>
                    <TextInput
                      accessibilityLabel="Day of birth"
                      keyboardType="number-pad"
                      maxLength={2}
                      value={state.birthDay}
                      onChangeText={(birthDay) => dispatch({ type: 'updateAccount', birthDay })}
                      placeholder="DD"
                      placeholderTextColor={tokens.text.secondary}
                      style={[styles.input, styles.flexCopy]}
                    />
                    <TextInput
                      accessibilityLabel="Month of birth"
                      keyboardType="number-pad"
                      maxLength={2}
                      value={state.birthMonth}
                      onChangeText={(birthMonth) => dispatch({ type: 'updateAccount', birthMonth })}
                      placeholder="MM"
                      placeholderTextColor={tokens.text.secondary}
                      style={[styles.input, styles.flexCopy]}
                    />
                    <TextInput
                      accessibilityLabel="Year of birth"
                      keyboardType="number-pad"
                      maxLength={4}
                      value={state.birthYear}
                      onChangeText={(birthYear) => dispatch({ type: 'updateAccount', birthYear })}
                      placeholder="YYYY"
                      placeholderTextColor={tokens.text.secondary}
                      style={[styles.input, styles.flexCopy]}
                    />
                  </View>
                  <Text style={styles.rowDetail}>
                    Only to check you're 18 or older. Never shown to anyone.
                  </Text>
                </>
              )}
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={state.email}
                onChangeText={(email) => dispatch({ type: 'updateAccount', email })}
                placeholder="you@example.com"
                placeholderTextColor={tokens.text.secondary}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoComplete={state.accountMode === 'login' ? 'current-password' : 'new-password'}
                secureTextEntry
                value={state.password}
                onChangeText={(password) => dispatch({ type: 'updateAccount', password })}
                placeholder="At least 12 characters"
                placeholderTextColor={tokens.text.secondary}
                style={styles.input}
              />
              {!authError && accountProblem(state) && (state.email || state.password) ? (
                <Text style={styles.rowDetail}>{accountProblem(state)}</Text>
              ) : null}
              {authNotice && !authError ? (
                <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
                  {authNotice}
                </Text>
              ) : null}
              {authError && (
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  {authError}
                </Text>
              )}
              {authFailureKind === 'account-exists' && (
                <Pressable
                  accessibilityRole="button"
                  disabled={authStatus === 'loading'}
                  onPress={() => {
                    setAuthError(undefined);
                    setAuthFailureKind(undefined);
                    setAuthStatus('idle');
                    dispatch({ type: 'startAccount', mode: 'login' });
                  }}
                >
                  <Text style={styles.textButton}>Sign in with this email</Text>
                </Pressable>
              )}
              {state.accountMode === 'login' && (
                <Pressable accessibilityRole="button" onPress={() => setRecovering(true)}>
                  <Text style={styles.textButton}>Forgot password?</Text>
                </Pressable>
              )}
              <PrimaryButton
                label={
                  authStatus === 'loading'
                    ? 'Please wait…'
                    : authStatus === 'error'
                      ? 'Try again'
                      : state.accountMode === 'login'
                        ? 'Sign in'
                        : 'Create account'
                }
                disabled={!canSubmitAccount(state) || authStatus === 'loading'}
                onPress={() => void authenticate()}
              />
              {state.accountMode === 'register' && legal.length >= 2 && (
                <>
                  <Text style={styles.rowDetail}>{SIGN_UP_AGREEMENT}</Text>
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
              <Pressable
                accessibilityRole="button"
                disabled={authStatus === 'loading'}
                onPress={() =>
                  dispatch({
                    type: 'startAccount',
                    mode: state.accountMode === 'login' ? 'register' : 'login'
                  })
                }
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
              <Text style={styles.onboardingTitle}>Set up your activity map.</Text>
              <Text style={styles.lead}>
                Precise location records your run. GPS points are encrypted on this device, then
                uploaded to RunSphere to check the run when you choose to sync. Uploaded raw GPS is
                kept for up to 30 days, and route maps are trimmed around your saved privacy zones.
              </Text>
              <PermissionCard
                icon="⌖"
                title="Precise location"
                detail="While recording; encrypted locally and uploaded only to validate a saved activity"
                badge="Required"
              />
              <PermissionCard
                icon="⌁"
                title="Background location"
                detail="Optional; only requested if you choose screen-lock recording before an activity"
                badge="Optional"
              />
              <PermissionCard
                icon="◉"
                title="Motion & fitness"
                detail="Optional; improves future estimates"
                badge="Optional"
              />
              <View style={styles.privacyRow}>
                <View style={styles.flexCopy}>
                  <Text style={styles.rowTitle}>Trim saved places</Text>
                  <Text style={styles.rowDetail}>
                    Saved privacy zones remove start, finish, and route fragments within 200 m
                    before a map can be shared
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Hide activity start and finish preference"
                  value={state.hideStartFinish}
                  onValueChange={(value) => dispatch({ type: 'setHideStartFinish', value })}
                  trackColor={{ false: tokens.border.subtle, true: tokens.status.success }}
                />
              </View>
              <Text style={styles.privateNote}>
                Activities stay private by default. Declining location still lets you browse
                RunSphere, but activity recording and nearby quests remain unavailable.
              </Text>
              {state.location !== 'granted' ? (
                <PrimaryButton label="Allow location" onPress={() => void requestLocation()} />
              ) : (
                <>
                  {state.motion === 'idle' && (
                    <Pressable accessibilityRole="button" onPress={() => void requestMotion()}>
                      <Text style={styles.textButton}>Allow motion & fitness (optional)</Text>
                    </Pressable>
                  )}
                  {state.motion !== 'idle' && (
                    <Text accessibilityLiveRegion="polite" style={styles.privateNote}>
                      Motion & fitness is {state.motion === 'granted' ? 'allowed' : 'not allowed'}.
                      This optional choice does not block RunSphere.
                    </Text>
                  )}
                  <PrimaryButton
                    label="Continue to RunSphere"
                    onPress={() => dispatch({ type: 'finish' })}
                  />
                </>
              )}
              {state.location !== 'granted' && (
                <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'finish' })}>
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
                Without location, activity recording and nearby quests are unavailable. Background
                location is optional and only requested when you choose screen-lock recording.
              </Text>
              {state.location === 'blocked' && (
                <Text style={styles.privateNote}>
                  Location is disabled for RunSphere. Enable it in Android Settings, then return
                  here.
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
                <Text style={styles.textButton}>Continue without activity mapping</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardSafe>
    </SafeAreaView>
  );
}
