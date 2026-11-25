import { interFamilyByWeight } from './type-style';
import regular from '../../assets/fonts/Inter_400Regular.ttf';
import medium from '../../assets/fonts/Inter_500Medium.ttf';
import semibold from '../../assets/fonts/Inter_600SemiBold.ttf';
import bold from '../../assets/fonts/Inter_700Bold.ttf';

/**
 * Loads the bundled Inter files. Resolves true when all four are registered and
 * false on any failure: the app then draws in the platform font rather than
 * waiting on, or failing because of, a typeface.
 */
export const loadInterFonts = async (): Promise<boolean> => {
  try {
    // Imported here, not at the top: expo-font needs the native runtime, and
    // every screen test that reaches the theme would otherwise have to mock it.
    const { loadAsync } = await import('expo-font');
    await loadAsync({
      [interFamilyByWeight.regular]: regular,
      [interFamilyByWeight.medium]: medium,
      [interFamilyByWeight.semibold]: semibold,
      [interFamilyByWeight.bold]: bold
    });
    return true;
  } catch {
    return false;
  }
};
