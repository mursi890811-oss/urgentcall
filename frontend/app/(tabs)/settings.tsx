import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function Settings() {
  const router = useRouter();
  const { user, signOut, refresh } = useAuth();
  const s = user?.settings || {};
  const [busy, setBusy] = useState(false);

  async function toggle(key: string, value: boolean) {
    setBusy(true);
    try { await api.patch("/api/users/me/settings", { [key]: value }); await refresh(); } catch {}
    setBusy(false);
  }

  function confirmLogout() {
    const doLogout = async () => { await signOut(); router.replace("/login"); };
    if (Platform.OS === "web") doLogout();
    else Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: doLogout },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="settings-screen">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.profileCard} testID="profile-card">
          <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials(user?.full_name || "U")}</Text></View>
          <Text style={styles.profileName}>{user?.full_name}</Text>
          <Text style={styles.profileMeta}>{user?.email}</Text>
          {user?.phone ? <Text style={styles.profileMeta}>{user.phone}</Text> : null}
        </View>

        <Section title="Notifications">
          <Row label="Override Silent Mode" icon="volume-high">
            <Switch value={!!s.override_silent} onValueChange={(v) => toggle("override_silent", v)} disabled={busy}
              trackColor={{ false: theme.border, true: theme.primary }} thumbColor="#fff" testID="settings-override-silent" />
          </Row>
          <Row label="Vibration" icon="phone-portrait">
            <Switch value={!!s.vibration} onValueChange={(v) => toggle("vibration", v)} disabled={busy}
              trackColor={{ false: theme.border, true: theme.primary }} thumbColor="#fff" testID="settings-vibration" />
          </Row>
          <Row label="Repeat alert if no response" icon="repeat">
            <Switch value={!!s.repeat_alert} onValueChange={(v) => toggle("repeat_alert", v)} disabled={busy}
              trackColor={{ false: theme.border, true: theme.primary }} thumbColor="#fff" testID="settings-repeat" />
          </Row>
        </Section>

        <Section title="Privacy">
          <RowDisplay label="Who can add me" icon="lock-closed" value={s.who_can_add || "everyone"} />
          <RowDisplay label="Blocked contacts" icon="ban" value="0 blocked" />
        </Section>

        <Section title="Account">
          <TouchableOpacity style={styles.actionRow} onPress={confirmLogout} testID="settings-logout-button">
            <Ionicons name="log-out-outline" size={20} color={theme.primary} />
            <Text style={[styles.actionText, { color: theme.primary }]}>Sign Out</Text>
          </TouchableOpacity>
        </Section>

        <Text style={styles.version}>UrgentCall v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: any) {
  return (
    <View style={{ marginTop: 24 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}
function Row({ label, icon, children }: any) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      {children}
    </View>
  );
}
function RowDisplay({ label, icon, value }: any) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  title: { color: "#fff", fontSize: 26, fontWeight: "800", marginBottom: 16 },
  profileCard: { backgroundColor: theme.surface, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 20, alignItems: "center" },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  profileAvatarText: { color: "#fff", fontSize: 26, fontWeight: "800" },
  profileName: { color: "#fff", fontSize: 18, fontWeight: "700" },
  profileMeta: { color: theme.textSecondary, marginTop: 4, fontSize: 13 },
  sectionTitle: { color: theme.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 },
  sectionCard: { backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  rowLabel: { color: "#fff", fontSize: 15 },
  rowValue: { color: theme.textSecondary, fontSize: 13 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  version: { color: theme.textTertiary, textAlign: "center", marginTop: 32, fontSize: 12 },
});
