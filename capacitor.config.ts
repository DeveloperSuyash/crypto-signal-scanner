import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.suyash.cryptosignal',
  appName: 'CryptoSignal',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#38BDF8',
    },
    BackgroundRunner: {
      label: 'com.suyash.cryptosignal.scanner',
      src: 'runners/background.js',
      event: 'checkSignals',
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
