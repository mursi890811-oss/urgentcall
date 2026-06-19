import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/AuthContext";
import {
  setupAndroidAlarmChannel,
  subscribeForegroundFcm,
  watchTokenRefresh,
} from "@/src/notifications/push";

SplashScreen.preventAutoHideAsync();

// NOTE: registerBackgroundHandler() is intentionally NOT called here. It already runs
// in index.js (the actual app entry point, loaded before this file) since Android only
// reliably invokes the FCM background handler if it's registered at the very top of the
// bundle - by the time this module evaluates, that registration must already be done.

// Foreground notification handler (module scope)
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

// Android channel (module scope) — kept for non-alarm notifications.
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "UrgentCall Alerts",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 500, 250, 500],
    lightColor: "#FF3B30",
    bypassDnd: true,
  });
  setupAndroidAlarmChannel();
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const router = useRouter();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // FCM foreground listener: when an incoming_alert arrives while the app is open,
  // jump straight to the alarm screen instead of waiting for a tap on a tray notification.
  useEffect(() => {
    const unsubscribe = subscribeForegroundFcm((data) => {
      router.push({ pathname: "/incoming-alert", params: { alertId: data.alert_id, senderName: data.sender_name, message: data.message } });
    });
    const tokenUnsub = watchTokenRefresh();
    return () => {
      unsubscribe();
      tokenUnsub();
    };
  }, [router]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data: any = response.notification.request.content.data || {};
      if (data.alert_id) {
        router.push({ pathname: "/incoming-alert", params: { alertId: data.alert_id } });
        return;
      }
      const url = data.deeplink || data.action_url;
      if (!url) return;
      if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
      else router.push(url);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data: any = response.notification.request.content.data || {};
      if (data.alert_id) {
        router.push({ pathname: "/incoming-alert", params: { alertId: data.alert_id } });
        return;
      }
      const url = data.deeplink || data.action_url;
      if (url) {
        if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
        else router.push(url);
      }
    });

    return () => { tapSub.remove(); };
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000" } }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
