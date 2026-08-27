import * as SecureStore from 'expo-secure-store';
import { createAuthStorage } from './auth-storage';

/** Tokens are stored in Android Keystore-backed SecureStore, never SQLite or AsyncStorage. */
export const authStorage = createAuthStorage(SecureStore);
