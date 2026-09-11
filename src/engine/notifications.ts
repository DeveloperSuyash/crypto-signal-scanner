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
