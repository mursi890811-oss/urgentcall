import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform, Linking, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SMS from "expo-sms";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

function initials(name: string) {
  return (name || "").split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function SendAlert() {
  const params = useLocalSearchParams<{ userId?: string }>();
  const router = useRouter();
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [invitedName, setInvitedName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function invite(contact: any) {
    setErr(null);
    const msg = `Hey ${contact.name}, I'm using UrgentCall to reach trusted people in emergencies — even when their phone is on silent. Install it so I can reach you when it matters: https://urgentcall.app`;

    try {
      const result = await Share.share({
        message: msg,
        title: "Invite to UrgentCall",
      });
      if (result.action !== Share.dismissedAction) {
        setInvitedName(`Invite sent to ${contact.name}`);
        setTimeout(() => setInvitedName(null), 2500);
      }
    } catch (e: any) {
      setErr(e?.message || "Couldn't open share sheet");
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const list = await api.get<any[]>("/api/contacts");
        setContacts(list);
        if (params.userId) {
          const found = list.find((c) => c.contact_user_id === params.userId);
          if (found) setSelected(found);
        }
      } catch {}
    })();
  }, [params.userId]);

  async function send() {
    if (!selected) return;
    setLoading(true); setErr(null);
    try {
      await api.post("/api/alerts", { receiver_user_id: selected.contact_user_id });
      setSent(true);
      setTimeout(() => router.back(), 1600);
    } catch (e: any) { setErr(e.message || "Failed to send"); }
    finally { setLoading(false); }
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.safe} testID="alert-sent-screen">
        <View style={styles.successWrap}>
          <View style={styles.successCircle}><Ionicons name="checkmark" size={56} color="#fff" /></View>
          <Text style={styles.successTitle}>Alert Sent!</Text>
          <Text style={styles.successSub}>{selected?.name} will be notified immediately</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} testID="send-alert-screen">
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} testID="back-button"><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
      </View>

      {!selected ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={styles.heading}>Select a contact</Text>
          <Text style={styles.sub}>Choose who to alert</Text>
          <View style={{ marginTop: 24, gap: 10 }}>
            {contacts.length === 0 && (
              <Text style={{ color: theme.textSecondary, textAlign: "center", marginTop: 40 }}>
                No contacts yet. Add some from the Contacts tab.
              </Text>
            )}
            {contacts.map((c) => {
              const isActive = c.status === "active" && c.contact_user_id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.contactRow, !isActive && { borderColor: theme.warn }]}
                  onPress={() => (isActive ? setSelected(c) : invite(c))}
                  testID={isActive ? "select-contact" : "invite-contact"}
                >
                  <View style={styles.contactAvatar}><Text style={styles.contactAvatarText}>{initials(c.name)}</Text></View>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactPhone}>{c.phone}</Text>
                  </View>
                  {isActive ? (
                    <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                  ) : (
                    <View style={styles.invitedTag}>
                      <Ionicons name="paper-plane" size={12} color={theme.warn} />
                      <Text style={styles.invitedTagText}>Send Invite</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          {invitedName && (
            <View style={styles.toast} testID="invite-toast">
              <Ionicons name="checkmark-circle" size={18} color={theme.success} />
              <Text style={styles.toastText}>{invitedName}</Text>
            </View>
          )}
          {err && (
            <View style={[styles.toast, { borderColor: theme.primary, bottom: 90 }]} testID="invite-err">
              <Ionicons name="alert-circle" size={18} color={theme.primary} />
              <Text style={styles.toastText}>{err}</Text>
            </View>
          )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.confirmWrap}>
          <View style={styles.bigAvatar}><Text style={styles.bigAvatarText}>{initials(selected.name)}</Text></View>
          <Text style={styles.heading}>Send emergency alert to {selected.name}?</Text>
          <Text style={styles.sub}>Their phone will ring even if on silent</Text>

          {err && <Text style={styles.err}>{err}</Text>}

          <TouchableOpacity style={[styles.sendBtn, loading && { opacity: 0.6 }]} onPress={send} disabled={loading} testID="confirm-send-alert-button">
            {loading ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="notifications" size={20} color="#fff" />
                <Text style={styles.sendBtnText}>Send Alert Now</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} testID="cancel-alert-button">
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  topBar: { padding: 20, flexDirection: "row", justifyContent: "flex-end" },
  heading: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: 8 },
  sub: { color: theme.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8 },
  confirmWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  bigAvatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: theme.surfaceElevated, borderWidth: 3, borderColor: theme.primary, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  bigAvatarText: { color: "#fff", fontSize: 36, fontWeight: "800" },
  err: { color: theme.primary, marginTop: 12 },
  sendBtn: { flexDirection: "row", gap: 10, backgroundColor: theme.primary, paddingHorizontal: 32, paddingVertical: 18, borderRadius: 14, marginTop: 32, width: "100%", justifyContent: "center" },
  sendBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
  cancelBtn: { paddingVertical: 16, marginTop: 8 },
  cancelBtnText: { color: theme.textSecondary, fontSize: 15, fontWeight: "600" },
  contactRow: { flexDirection: "row", alignItems: "center", backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14 },
  contactAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surfaceElevated, alignItems: "center", justifyContent: "center" },
  contactAvatarText: { color: "#fff", fontWeight: "700" },
  contactName: { color: "#fff", fontWeight: "600" },
  contactPhone: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  invitedTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.warn, backgroundColor: "rgba(255,149,0,0.08)" },
  invitedTagText: { color: theme.warn, fontSize: 11, fontWeight: "700" },
  toast: { position: "absolute", bottom: 32, left: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.surfaceElevated, borderWidth: 1, borderColor: theme.success, borderRadius: 12, padding: 14 },
  toastText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  successCircle: { width: 110, height: 110, borderRadius: 55, backgroundColor: theme.success, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  successTitle: { color: "#fff", fontSize: 26, fontWeight: "800" },
  successSub: { color: theme.textSecondary, marginTop: 8, textAlign: "center", paddingHorizontal: 32 },
});
