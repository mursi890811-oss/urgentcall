import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Animated, Vibration, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAudioPlayer } from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

function initials(name: string) {
  return (name || "").split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function IncomingAlert() {
  const params = useLocalSearchParams<{ alertId?: string; senderName?: string; message?: string }>();
  const router = useRouter();
  const [alert, setAlertData] = useState<any | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const timer = useRef<any>(null);
  const hapticInterval = useRef<any>(null);
  const stoppedRef = useRef(false);

  // Bundled local alarm sound - NOT a remote URL. A remote URL means the alarm could
  // fail to play on a slow/flaky connection at the exact moment it matters most.
  // Place a real alarm/siren audio file at assets/sounds/alarm.mp3 (see README note).
  const player = useAudioPlayer(require("@/assets/sounds/alarm.mp3"));

  function stopAll() {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    try { Vibration.cancel(); } catch {}
    if (hapticInterval.current) { clearInterval(hapticInterval.current); hapticInterval.current = null; }
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try { player.pause(); } catch {}
    try { deactivateKeepAwake("urgentcall-alarm"); } catch {}
  }

  // Alert data can arrive two ways: (1) navigated to directly from the FCM foreground
  // listener with sender/message already in params, or (2) opened from a tray notification
  // with only an alertId, in which case we fetch full details from /alerts/pending.
  useEffect(() => {
    if (params.senderName) {
      setAlertData({
        id: params.alertId,
        sender_name: params.senderName,
        message: params.message,
      });
      return;
    }
    (async () => {
      try {
        const list = await api.get<any[]>("/api/alerts/pending");
        const found = params.alertId ? list.find((a) => a.id === params.alertId) : list[0];
        if (found) setAlertData(found);
        else router.back();
      } catch { router.back(); }
    })();
  }, [params.alertId, params.senderName, params.message, router]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: false }),
      ])
    ).start();

    if (Platform.OS !== "web") {
      // Keep the screen on so the alarm UI doesn't go dark/lock mid-ring.
      activateKeepAwakeAsync("urgentcall-alarm").catch(() => {});
      Vibration.vibrate([0, 500, 300, 500, 300, 500], true);
      hapticInterval.current = setInterval(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }, 1500);
      try { player.loop = true; player.play(); } catch {}

      timer.current = setTimeout(() => respond("dismiss", true), 60_000);
      return () => { stopAll(); };
    }
    return () => { stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function respond(action: "acknowledge" | "dismiss", auto = false) {
    if (!alert) return;
    // Stop the alarm immediately, before the network call - the person should never have
    // to wait on a slow request just to silence their phone.
    stopAll();
    router.back();
    try {
      await api.post(`/api/alerts/${alert.id}/respond`, { action: auto ? "dismiss" : action });
    } catch {
      // Best-effort retry once in the background; the alarm is already stopped locally
      // regardless, since that's the user-facing promise that matters most.
      try { await api.post(`/api/alerts/${alert.id}/respond`, { action: auto ? "dismiss" : action }); } catch {}
    }
  }

  const bg = pulse.interpolate({ inputRange: [0, 1], outputRange: ["#8B0000", "#FF3B30"] });

  if (!alert) return <View style={[styles.container, { backgroundColor: theme.primary }]} />;

  return (
    <Animated.View style={[styles.container, { backgroundColor: bg }]} testID="incoming-alert-screen">
      <View style={styles.content}>
        <Ionicons name="flash" size={36} color="#fff" style={{ marginBottom: 16 }} />
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(alert.sender_name)}</Text></View>
        <Text style={styles.alertText}>⚡ {alert.sender_name} needs you urgently!</Text>
        {alert.message && (
          <View style={styles.msgBubble} testID="incoming-alert-message">
            <Text style={styles.msgText}>“{alert.message}”</Text>
          </View>
        )}
        <Text style={styles.subText}>Emergency alert received</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ackBtn} onPress={() => respond("acknowledge")} testID="incoming-alert-acknowledge-button">
          <Ionicons name="checkmark-circle" size={26} color="#fff" />
          <Text style={styles.ackText}>I&apos;m OK</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dismissBtn} onPress={() => respond("dismiss")} testID="incoming-alert-dismiss-button">
          <Text style={styles.dismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "space-between", paddingVertical: 80 },
  content: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  avatar: { width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", marginBottom: 24, borderWidth: 3, borderColor: "#fff" },
  avatarText: { color: "#fff", fontSize: 48, fontWeight: "800" },
  alertText: { color: "#fff", fontSize: 24, fontWeight: "800", textAlign: "center" },
  subText: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 12 },
  msgBubble: { backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16, marginTop: 16, maxWidth: "85%" },
  msgText: { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center", lineHeight: 22 },
  actions: { padding: 24, gap: 12 },
  ackBtn: { flexDirection: "row", gap: 10, backgroundColor: theme.success, paddingVertical: 20, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  ackText: { color: "#fff", fontWeight: "800", fontSize: 17, letterSpacing: 0.5 },
  dismissBtn: { paddingVertical: 14, alignItems: "center" },
  dismissText: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "600" },
});
