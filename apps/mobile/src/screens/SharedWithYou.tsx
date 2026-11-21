import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { SafetyShareReceived } from '@runsphere/contracts';
import type { MobileApiClient } from '../api-client';
import { useAppStyles } from '../components/styles';
import {
  approximateAreaUrl,
  latestUpdate,
  shareReadFailureMessage,
  sharedRowLabel,
  type LatestUpdate
} from './shared-with-you-model';

/**
 * Safety shares other runners are sending you (M3.6). Each one can be checked:
 * the newest update, 15 minutes late and only as precise as a 500 m tile, with
 * a button that opens that approximate area in a maps app. Nothing shows when
 * nobody is sharing with you.
 */
export function SharedWithYou({
  api,
  openUrl = (url) => Linking.openURL(url)
}: {
  api: Pick<MobileApiClient, 'listReceivedSafetyShares' | 'readDelayedSafetyShare'>;
  openUrl?: (url: string) => Promise<unknown>;
}) {
  const styles = useAppStyles();
  const [shares, setShares] = useState<readonly SafetyShareReceived[]>([]);
  const [checked, setChecked] = useState<Readonly<Record<string, LatestUpdate | string>>>({});

  useEffect(() => {
    let active = true;
    void api
      .listReceivedSafetyShares()
      .then((found) => {
        if (active) setShares(found);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  const check = async (id: string) => {
    try {
      const update = latestUpdate(await api.readDelayedSafetyShare(id));
      setChecked((current) => ({ ...current, [id]: update }));
    } catch (error) {
      setChecked((current) => ({ ...current, [id]: shareReadFailureMessage(error) }));
    }
  };

  if (shares.length === 0) return null;
  return (
    <View style={styles.settingStack}>
      <Text style={styles.fieldLabel}>SHARED WITH YOU</Text>
      {shares.map((share) => {
        const label = sharedRowLabel(share);
        const result = checked[share.id];
        return (
          <View key={share.id} style={styles.settingStack}>
            <Text style={styles.rowTitle}>{label.title}</Text>
            <Text style={styles.rowDetail}>{label.detail}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Check in on ${share.sharerDisplayName}`}
              onPress={() => void check(share.id)}
            >
              <Text style={styles.link}>Check in</Text>
            </Pressable>
            {typeof result === 'string' ? (
              <Text style={styles.rowDetail}>{result}</Text>
            ) : result ? (
              <>
                <Text accessibilityLiveRegion="polite" style={styles.rowDetail}>
                  {result.message}
                </Text>
                {result.kind === 'seen' && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open the approximate area for ${share.sharerDisplayName} in maps`}
                    onPress={() => void openUrl(approximateAreaUrl(result.centre))}
                  >
                    <Text style={styles.link}>Open approximate area</Text>
                  </Pressable>
                )}
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
