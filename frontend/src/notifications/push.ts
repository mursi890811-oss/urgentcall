// Push notification setup using real Firebase Cloud Messaging (not Expo's push relay).
// This is what lets an incoming alert wake the app even when it's backgrounded or fully
// killed on Android: FCM delivers a high-priority data message to the OS, our background
// handler (registered at module scope, before any component renders) catches it and shows
// a full-screen-intent local notification that rings like an incoming call.

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import messaging from "@react-native-firebase/messaging";
import { api } from "@/src/api/client";

export const ALARM_CHANNEL_ID = "urgentcall-alarm";

export async function setupAndroidAlarmChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: "Emergency Alerts",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    lightColor: "#FF3B30",
    bypassDnd: true,
    // Full-screen intent is what lets this notification take over the screen like an
    // incoming call, instead of just appearing in the notification shade.
  });
}

async function showFullScreenAlarmNotification(data: Record<string, string>) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚨 ${data.sender_name || "Someone"} needs you urgently!`,
      body: data.message || "Tap to respond",
      data,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.MAX,
      // The actual full-screen takeover (over lock screen, like an incoming call) is
      // completed by the dev-client native config: full-screen-intent permission +
      // the notification importance/channel set above.
      ...(Platform.OS === "android" ? { channelId: ALARM_CHANNEL_ID } : {}),
    },
    trigger: null, // show immediately
  });
}

/**
 * Registers the background message handler. MUST be called at module scope (e.g. in the
 * root index.js / _layout.tsx import chain) before the app finishes loading, or Android
 * will not invoke it for messages received while the app is killed.
 */
export function registerBackgroundHandler() {
  if (Platform.OS !== "android") return;
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    const data = (remoteMessage.data || {}) as Record<string, string>;
    if (data.type === "incoming_alert") {
      await showFullScreenAlarmNotification(data);
    }
    // alert_response (sender side) is handled by the regular notification tray —
    // no need for a full-screen takeover when you're the one who sent the alert.
  });
}

/** Foreground listener — plain subscribe/unsubscribe function (not a Hook), call once
 * from inside a useEffect in a top-level component (e.g. RootLayout). Named without a
 * "use" prefix on purpose so eslint-plugin-react-hooks doesn't mistake it for a Hook. */
export function subscribeForegroundFcm(onIncomingAlert: (data: Record<string, string>) => void) {
  if (Platform.OS !== "android") return () => {};
  const unsubscribe = messaging().onMessage(async (remoteMessage) => {
    const data = (remoteMessage.data || {}) as Record<string, string>;
    if (data.type === "incoming_alert") {
      onIncomingAlert(data);
    } else if (data.type === "alert_response") {
      await showFullScreenAlarmNotification({
        sender_name: data.responder_name,
        message: data.status === "acknowledged" ? "They're OK!" : "Alert dismissed",
      });
    }
  });
  return unsubscribe;
}

export async function requestPushPermissionAndRegister(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  try {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) return null;

    const token = await messaging().getToken();
    if (token) {
      await api.post("/api/register-push", { platform: "android", device_token: token });
    }
    return token;
  } catch (e) {
    console.warn("Push registration failed (non-blocking):", e);
    return null;
  }
}

/** Call once at app start so token refreshes (e.g. app reinstall) stay registered. */
export function watchTokenRefresh() {
  if (Platform.OS !== "android") return () => {};
  return messaging().onTokenRefresh(async (token) => {
    try {
      await api.post("/api/register-push", { platform: "android", device_token: token });
    } catch (e) {
      console.warn("Push token refresh registration failed:", e);
    }
  });
}
