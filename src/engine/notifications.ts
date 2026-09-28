import { LocalNotifications } from '@capacitor/local-notifications';

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') {
      const res = await LocalNotifications.requestPermissions();
      return res.display === 'granted';
    }
    return true;
  } catch {
    return false;
  }
}

export async function sendNativeNotification(title: string, body: string, id: number = Date.now()) {
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          title,
          body,
          id: Math.abs(id % 2147483647),
          schedule: { at: new Date(Date.now() + 100) },
          sound: undefined,
          extra: null,
        },
      ],
    });
  } catch (e) {
    console.log('Native notification fallback (browser mode):', e);
  }
}

// Schedules a real OS notification ~1 minute from now, independent of the
// app's foreground/background state, so the notification+sound pipeline can
// be verified end-to-end by switching away from the app after triggering it.
export async function sendTestNotification(delaySeconds: number = 60) {
  await LocalNotifications.schedule({
    notifications: [
      {
        title: '🔔 Test Alert: BTC/USDT',
        body: 'This is a test notification to verify sound + delivery while the app is backgrounded.',
        id: Math.abs(Date.now() % 2147483647),
        schedule: { at: new Date(Date.now() + delaySeconds * 1000) },
        extra: null,
      },
    ],
  });
}
