import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import {
  AppState,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { colors } from '@runsphere/ui';
import type { MobileApiClient } from '../api-client';
import { AuthFailure } from '../auth-failure';
import { getLocationPermissionState } from '../location-permission';
import { canSubmitAccount } from '../onboarding';
import type { initialOnboardingState, onboardingReducer } from '../onboarding';
import {
  MovementChoice,
  PermissionCard,
  PrimaryButton,
  StepHeader
} from '../components/primitives';
import { styles } from '../components/styles';

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
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
  const [authError, setAuthError] = useState<string>();
  const [authFailureKind, setAuthFailureKind] = useState<AuthFailure['kind']>();
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
              ageAssertion: true,
              policyVersion: 'm1-private-pilot'
            });
      onAuthenticated(session);
      dispatch({ type: 'authenticationSucceeded' });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to complete authentication.');
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
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.onboardingContent}
        keyboardShouldPersistTaps="handled"
      >
        {state.step === 'welcome' && (
          <>
            <View accessible={false} style={styles.hero}>
              <View style={styles.orbitOne} />
              <View style={styles.orbitTwo} />
              <Text style={styles.heroPin}>◆</Text>
            </View>
            <Text style={styles.eyebrow}>YOUR WORLD, IN MOTION</Text>
            <Text style={styles.onboardingTitle}>
              Move outside.{'\n'}
              <Text style={styles.teal}>Make it yours.</Text>
            </Text>
            <Text style={styles.lead}>
              Turn everyday walks, runs, and hikes into exploration quests—with seasonal competition
              that stays fair.
            </Text>
            <MovementChoice
              selected={state.movement}
              onChoose={(movement) => dispatch({ type: 'chooseMovement', movement })}
            />
            <PrimaryButton
              label="Create account"
              onPress={() => dispatch({ type: 'startAccount', mode: 'register' })}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I already have an account"
              onPress={() => dispatch({ type: 'startAccount', mode: 'login' })}
            >
              <Text style={styles.textButton}>I already have an account</Text>
            </Pressable>
          </>
        )}
        {state.step === 'account' && (
          <>
            <StepHeader
              step={state.accountMode === 'login' ? 'SIGN IN' : 'STEP 1 OF 3'}
              onBack={() => dispatch({ type: 'back' })}
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
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
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
              placeholderTextColor={colors.muted}
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
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            {state.accountMode === 'register' && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: state.isAdult }}
                accessibilityLabel="I confirm that I am 18 or older"
                onPress={() => dispatch({ type: 'updateAccount', isAdult: !state.isAdult })}
                style={styles.checkRow}
              >
                <View style={[styles.checkbox, state.isAdult && styles.checkboxChecked]}>
                  {state.isAdult && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <Text style={styles.checkCopy}>I confirm that I am 18 or older.</Text>
              </Pressable>
            )}
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
        {state.step === 'privacy' && (
          <>
            <StepHeader step="STEP 2 OF 3" onBack={() => dispatch({ type: 'back' })} />
            <View accessible={false} style={styles.miniMap}>
              <Text style={styles.mapRoute}>⌁</Text>
              <Text style={styles.mapShield}>✓</Text>
            </View>
            <Text style={styles.eyebrow}>YOU’RE IN CONTROL</Text>
            <Text style={styles.onboardingTitle}>Set up your activity map.</Text>
            <Text style={styles.lead}>
              Precise location records your activity. GPS samples are encrypted on this device, then
              uploaded for server validation when you choose to sync. Raw submitted GPS is retained
              for up to 30 days; eligible maps are trimmed around saved privacy zones.
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
                  Saved privacy zones remove start, finish, and route fragments within 200 m before
                  a map can be shared
                </Text>
              </View>
              <Switch
                accessibilityLabel="Hide activity start and finish preference"
                value={state.hideStartFinish}
                onValueChange={(value) => dispatch({ type: 'setHideStartFinish', value })}
                trackColor={{ false: colors.line, true: colors.teal }}
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
                Location is disabled for RunSphere. Enable it in Android Settings, then return here.
              </Text>
            )}
            <PrimaryButton
              label={state.location === 'blocked' ? 'Open location settings' : 'Try location again'}
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
    </SafeAreaView>
  );
}
