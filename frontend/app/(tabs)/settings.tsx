import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Platform, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

const WHO_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: "everyone", label: "Everyone", desc: "Anyone with your number or email" },
  { value: "contacts", label: "My Contacts Only", desc: "Only people who added you back" },
  { value: "nobody", label: "Nobody", desc: "Pause incoming alerts" },
];

export default function Settings() {
  const router = useRouter();
  const { user, signOut, refresh } = useAuth();
  const s = user?.settings || {};
  const [busy, setBusy] = useState(false);
  const [whoModal, setWhoModal] = useState(false);

  async function toggle(key: string, value: boolean) {
    setBusy(true);
    try { await api.patch("/api/users/me/settings", { [key]: value }); await refresh(); } catch {}
    setBusy(false);
  }

  async function setWhoCanAdd(value: string) {
    setWhoModal(false);
    setBusy(true);
    try { await api.patch("/api/users/me/settings", { who_can_add: value }); await refresh(); } catch {}
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

  const whoLabel = WHO_OPTIONS.find((o) => o.value === (s.who_can_add || "everyone"))?.label || "Everyone";

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
          <Row label="Repeat alert if no response" icon="repeat" isLast>
            <Switch value={!!s.repeat_alert} onValueChange={(v) => toggle("repeat_alert", v)} disabled={busy}
              trackColor={{ false: theme.border, true: theme.primary }} thumbColor="#fff" testID="settings-repeat" />
          </Row>
        </Section>

        <Section title="Privacy">
          <TouchableOpacity
            style={styles.row}
            onPress={() => setWhoModal(true)}
            testID="settings-who-can-add"
          >
            <Ionicons name="lock-closed" size={18} color={theme.textSecondary} />
            <Text style={styles.rowLabel}>Who can add me</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.rowValue}>{whoLabel}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowLast]}
            onPress={() => router.push("/blocked" as any)}
            testID="settings-blocked-contacts"
          >
            <Ionicons name="ban" size={18} color={theme.textSecondary} />
            <Text style={styles.rowLabel}>Blocked contacts</Text>
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </Section>

        <Section title="Account">
          <TouchableOpacity style={styles.actionRow} onPress={confirmLogout} testID="settings-logout-button">
            <Ionicons name="log-out-outline" size={20} color={theme.primary} />
            <Text style={[styles.actionText, { color: theme.primary }]}>Sign Out</Text>
          </TouchableOpacity>
        </Section>

        <Text style={styles.version}>UrgentCall v1.0.0</Text>
      </ScrollView>

      <Modal
        visible={whoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setWhoModal(false)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setWhoModal(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} testID="who-can-add-sheet">
            <Text style={styles.sheetTitle}>Who can add me</Text>
            <Text style={styles.sheetSub}>Control who can add you as a trusted contact</Text>
            {WHO_OPTIONS.map((opt) => {
              const active = (s.who_can_add || "everyone") === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.optRow, active && styles.optRowActive]}
                  onPress={() => setWhoCanAdd(opt.value)}
                  testID={`who-opt-${opt.value}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optLabel}>{opt.label}</Text>
                    <Text style={styles.optDesc}>{opt.desc}</Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={22} color={theme.primary} />}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity onPress={() => setWhoModal(false)} style={styles.closeBtn} testID="who-close-button">
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
function Row({ label, icon, children, isLast }: any) {
  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      {children}
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
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { color: "#fff", fontSize: 15 },
  rowValue: { color: theme.textSecondary, fontSize: 13 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  version: { color: theme.textTertiary, textAlign: "center", marginTop: 32, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderTopWidth: 1, borderColor: theme.border, paddingBottom: 32 },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  sheetSub: { color: theme.textSecondary, fontSize: 13, marginTop: 6, marginBottom: 16 },
  optRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, marginBottom: 8, backgroundColor: theme.surfaceElevated },
  optRowActive: { borderColor: theme.primary },
  optLabel: { color: "#fff", fontWeight: "700", fontSize: 15 },
  optDesc: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: { marginTop: 8, paddingVertical: 14, alignItems: "center" },
  closeText: { color: theme.textSecondary, fontWeight: "600" },
});
