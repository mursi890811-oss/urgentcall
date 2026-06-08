import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, RefreshControl,
  Platform, AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

type Contact = {
  id: string; name: string; phone: string; email?: string;
  contact_user_id?: string | null; status: string; avatar_url?: string | null;
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const pollTimer = useRef<any>(null);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  const load = useCallback(async () => {
    try {
      const list = await api.get<Contact[]>("/api/contacts");
      setContacts(list.filter((c) => c.status === "active"));
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Push registration on mobile
  useEffect(() => {
    if (Platform.OS === "web" || !user) return;
    (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") return;
        const tok = await Notifications.getDevicePushTokenAsync();
        await api.post("/api/register-push", { platform: Platform.OS, device_token: tok.data });
      } catch {}
    })();
  }, [user]);

  // Poll for incoming alerts
  useEffect(() => {
    if (!user) return;
    async function poll() {
      try {
        const pending = await api.get<any[]>("/api/alerts/pending");
        if (pending.length > 0) {
          const latest = pending[0];
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          router.push(`/incoming-alert?alertId=${latest.id}` as any);
        }
      } catch {}
    }
    pollTimer.current = setInterval(poll, 5000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") poll(); });
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); sub.remove(); };
  }, [user, router]);

  function onSendAlertPressed(contactUserId?: string) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (contactUserId) router.push(`/send-alert?userId=${contactUserId}` as any);
    else router.push("/send-alert" as any);
  }

  async function onRefresh() {
    setRefreshing(true); await load(); setRefreshing(false);
  }

  const greeting = user?.full_name?.split(" ")[0] || "there";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="home-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hey, {greeting} 👋</Text>
            <Text style={styles.sub}>Ready when you need it</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/(tabs)/settings")} testID="home-avatar">
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user?.full_name || "U")}</Text></View>
          </TouchableOpacity>
        </View>

        <View style={styles.alertWrap}>
          <Animated.View style={[styles.alertShadow, { transform: [{ scale: pulse }] }]} />
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onSendAlertPressed()}
            style={styles.alertBtn}
            testID="home-send-alert-button"
          >
            <Ionicons name="notifications" size={56} color="#fff" />
            <Text style={styles.alertBtnText}>SEND ALERT</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.alertHint}>Tap to send emergency alert</Text>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Trusted Contacts</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/contacts")} testID="home-see-all">
              <Text style={styles.linkText}>See all</Text>
            </TouchableOpacity>
          </View>
          {contacts.length === 0 ? (
            <TouchableOpacity style={styles.emptyCard} onPress={() => router.push("/add-contact" as any)} testID="home-add-first-contact">
              <Ionicons name="person-add" size={28} color={theme.primary} />
              <Text style={styles.emptyTitle}>Add your first trusted contact</Text>
              <Text style={styles.emptySub}>People you trust to reach in emergencies</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 20 }}>
              {contacts.map((c) => (
                <TouchableOpacity
                  key={c.id} style={styles.contactCard} testID="home-trusted-contact-card"
                  onPress={() => onSendAlertPressed(c.contact_user_id || undefined)}
                >
                  <View style={styles.contactAvatar}>
                    <Text style={styles.contactAvatarText}>{initials(c.name)}</Text>
                    <View style={styles.statusDot} />
                  </View>
                  <Text style={styles.contactName} numberOfLines={1}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 32 },
  greeting: { color: "#fff", fontSize: 24, fontWeight: "700" },
  sub: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surfaceElevated, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700" },
  alertWrap: { alignItems: "center", justifyContent: "center", marginTop: 24, height: 240 },
  alertShadow: { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: theme.primary, opacity: 0.18 },
  alertBtn: {
    width: 200, height: 200, borderRadius: 100, backgroundColor: theme.primary,
    alignItems: "center", justifyContent: "center",
    shadowColor: theme.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 24, elevation: 16,
  },
  alertBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 1.5, marginTop: 8 },
  alertHint: { color: theme.textSecondary, textAlign: "center", marginTop: 12, fontSize: 14 },
  section: { marginTop: 36 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sectionTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  linkText: { color: theme.primary, fontSize: 14, fontWeight: "600" },
  emptyCard: { backgroundColor: theme.surface, borderRadius: 16, borderWidth: 1, borderColor: theme.border, padding: 24, alignItems: "center" },
  emptyTitle: { color: "#fff", fontWeight: "700", fontSize: 15, marginTop: 12 },
  emptySub: { color: theme.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  contactCard: { alignItems: "center", width: 76 },
  contactAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.surfaceElevated, borderWidth: 2, borderColor: theme.border, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  contactAvatarText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  statusDot: { position: "absolute", bottom: 2, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.success, borderWidth: 2, borderColor: theme.bg },
  contactName: { color: "#fff", fontSize: 12, textAlign: "center" },
});
