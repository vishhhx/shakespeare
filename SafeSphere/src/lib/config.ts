import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function extractHostFromUrlLike(value?: string) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function getExpoDevHost() {
  const expoConfigHost = Constants.expoConfig?.hostUri;
  const expoGoDebuggerHost = (Constants as any).expoGoConfig?.debuggerHost as string | undefined;
  const linkingUri = (Constants as any).linkingUri as string | undefined;
  const sourceCodeScriptUrl = (NativeModules as any)?.SourceCode?.scriptURL as string | undefined;

  // Development build deep links often look like:
  // myapp://expo-development-client/?url=http%3A%2F%2F192.168.x.x%3A8081
  const deepLinkMetroUrl = (() => {
    if (!linkingUri) {
      return undefined;
    }

    try {
      const parsed = new URL(linkingUri);
      return parsed.searchParams.get('url') || undefined;
    } catch {
      return undefined;
    }
  })();

  const hostUri = expoConfigHost || expoGoDebuggerHost || deepLinkMetroUrl || sourceCodeScriptUrl;

  if (!hostUri) {
    return undefined;
  }

  const detectedHost = extractHostFromUrlLike(hostUri) || hostUri.split(':')[0];
  console.log('Detected Expo development host:', hostUri, '=>', detectedHost);
  return detectedHost;
}

function replaceLocalhost(url: string, host: string) {
  return url
    .replace('://localhost', `://${host}`)
    .replace('://127.0.0.1', `://${host}`);
}

function isLoopbackHost(host?: string) {
  if (!host) {
    return false;
  }

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function getFallbackHost() {
  if (process.env.EXPO_PUBLIC_DEV_HOST?.trim()) {
    return process.env.EXPO_PUBLIC_DEV_HOST.trim();
  }

  if (process.env.EXPO_OS === 'android') {
    return '10.0.2.2';
  }

  return 'localhost';
}

const expoHost = getExpoDevHost();
const manualDevHost = (process.env.EXPO_PUBLIC_DEV_HOST || '').trim();
const preferredHost = manualDevHost || (isLoopbackHost(expoHost) ? undefined : expoHost);
const fallbackHost = preferredHost || getFallbackHost();

const appType = (process.env.EXPO_PUBLIC_APP_TYPE || '').toLowerCase();
const isTest = appType === 'test';
const testBackendBaseUrl = stripTrailingSlash(process.env.EXPO_PUBLIC_TEST_BACKEND_URL || '');

const testApiBaseUrl = testBackendBaseUrl ? `${testBackendBaseUrl}/api` : '';
const testSocketUrl = testBackendBaseUrl;

const defaultApiBaseUrl = `http://${fallbackHost}:4000/api`;
const defaultSocketUrl = `http://${fallbackHost}:4000`;
const lanFallbackApiBaseUrl = `http://${fallbackHost}:4000/api`;
const lanFallbackSocketUrl = `http://${fallbackHost}:4000`;

const rawApiBaseUrl =
  isTest && testApiBaseUrl
    ? testApiBaseUrl
    : process.env.EXPO_PUBLIC_API_URL || defaultApiBaseUrl;
const rawSocketUrl =
  isTest && testSocketUrl
    ? testSocketUrl
    : process.env.EXPO_PUBLIC_SOCKET_URL || defaultSocketUrl;

const apiBaseUrl = preferredHost ? replaceLocalhost(rawApiBaseUrl, preferredHost) : rawApiBaseUrl;
const socketUrl = preferredHost ? replaceLocalhost(rawSocketUrl, preferredHost) : rawSocketUrl;

export const config = {
  appType,
  isTest,
  preferredHost,
  apiBaseUrl,
  socketUrl,
  // Fallback must stay on local/LAN backend, not ngrok.
  fallbackApiBaseUrl: lanFallbackApiBaseUrl,
  fallbackSocketUrl: lanFallbackSocketUrl,
  testApiBaseUrl,
  testSocketUrl,
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  useNativeNavigationSdk: process.env.EXPO_PUBLIC_USE_NATIVE_NAV_SDK === 'true',
};

export const isNativeNavigationAvailable =
  config.useNativeNavigationSdk && Constants.appOwnership !== 'expo';
