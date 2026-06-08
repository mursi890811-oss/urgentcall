import { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform,
  KeyboardAvoidingView, ActivityIndicator, FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

export default function AddContact() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const router = useRouter();
  const isPhonebook = params.mode === "phonebook";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [searchResult, setSearchResult] = useState<any | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [phonebook, setPhonebook] = useState<any[]>([]);
  const [pbQuery, setPbQuery] = useState("");
  const [permDenied, setPermDenied] = useState(false);

  useEffect(() => {
    if (!isPhonebook) return;
    if (Platform.OS === "web") { setPermDenied(true); return; }
    (async () => {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") { setPermDenied(true); return; }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      });
      setPhonebook(data.filter((c) => c.name && c.phoneNumbers && c.phoneNumbers.length > 0));
    })();
  }, [isPhonebook]);

  async function search() {
    setErr(null);
    if (!phone && !email) { setErr("Enter phone or email"); return; }
    setSearching(true);
    try {
      const q = email || phone;
      const res = await api.post<{ found: boolean; user?: any }>("/api/users/search", { query: q });
      if (res.found && res.user) {
        setSearchResult(res.user);
        if (!name) setName(res.user.full_name || "");
      } else { setSearchResult({ notFound: true }); }
    } catch (e: any) { setErr(e.message); }
    finally { setSearching(false); }
  }

  async function save(prefName?: string, prefPhone?: string, prefEmail?: string) {
    const nm = prefName || name; const ph = prefPhone || phone; const em = prefEmail || email;
    if (!nm || !ph) { setErr("Name and phone are required"); return; }
    setSaving(true); setErr(null);
    try {
      await api.post("/api/contacts", { name: nm, phone: ph, email: em || undefined });
      router.back();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  function pickFromPhonebook(c: any) {
    const ph = c.phoneNumbers?.[0]?.number || "";
    const em = c.emails?.[0]?.email || "";
    save(c.name, ph, em);
  }

  if (isPhonebook) {
    return (
      <SafeAreaView style={styles.safe} testID="add-from-phonebook">
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
          <Text style={styles.topTitle}>From Phonebook</Text>
          <View style={{ width: 28 }} />
        </View>

        {permDenied ? (
          <View style={styles.empty}>
            <Ionicons name="lock-closed" size={42} color={theme.textTertiary} />
            <Text style={styles.emptyTitle}>Contacts permission needed</Text>
            <Text style={styles.emptySub}>
              {Platform.OS === "web" ? "Phonebook is only available on mobile devices" : "Grant contacts permission to import people"}
            </Text>
            <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace("/add-contact?mode=manual" as any)}>
              <Text style={styles.linkText}>Add manually instead →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={theme.textSecondary} />
              <TextInput style={styles.searchInput} placeholder="Search phonebook" placeholderTextColor={theme.textTertiary}
                value={pbQuery} onChangeText={setPbQuery} />
            </View>
            <FlatList
              data={phonebook.filter((c) => !pbQuery || c.name.toLowerCase().includes(pbQuery.toLowerCase()))}
              keyExtractor={(it, idx) => it.id || String(idx)}
              contentContainerStyle={{ padding: 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pbRow} onPress={() => pickFromPhonebook(item)} testID="phonebook-row">
                  <Ionicons name="person-circle" size={36} color={theme.textSecondary} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.pbName}>{item.name}</Text>
                    <Text style={styles.pbPhone}>{item.phoneNumbers?.[0]?.number}</Text>
                  </View>
                  <Ionicons name="add-circle" size={26} color={theme.primary} />
                </TouchableOpacity>
              )}
            />
          </>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} testID="add-contact-manual">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity>
          <Text style={styles.topTitle}>Add Manually</Text>
          <View style={{ width: 28 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Jane Doe"
            placeholderTextColor={theme.textTertiary} testID="manual-name-input" />
          <Text style={styles.label}>Phone Number</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
            placeholder="+1 555 0100" placeholderTextColor={theme.textTertiary} testID="manual-phone-input" />
          <Text style={styles.label}>Email (optional)</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address"
            autoCapitalize="none" placeholder="jane@email.com" placeholderTextColor={theme.textTertiary}
            testID="manual-email-input" />

          <TouchableOpacity style={styles.searchBtn} onPress={search} disabled={searching} testID="search-user-button">
            {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchBtnText}>Search UrgentCall users</Text>}
          </TouchableOpacity>

          {searchResult && !searchResult.notFound && (
            <View style={styles.foundCard} testID="user-found-card">
              <Ionicons name="checkmark-circle" size={22} color={theme.success} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.foundName}>{searchResult.full_name}</Text>
                <Text style={styles.foundEmail}>{searchResult.email} • Has UrgentCall</Text>
              </View>
            </View>
          )}
          {searchResult?.notFound && (
            <View style={styles.notFoundCard} testID="user-notfound-card">
              <Ionicons name="information-circle" size={22} color={theme.warn} />
              <Text style={styles.notFoundText}>Not found. They&apos;ll be invited via SMS when you add them.</Text>
            </View>
          )}

          {err && <Text style={styles.err}>{err}</Text>}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={() => save()} disabled={saving} testID="save-contact-button">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Add to Trusted Contacts</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20 },
  topTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  label: { color: theme.textSecondary, fontSize: 13, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: theme.surfaceElevated, borderRadius: 12, padding: 16, color: "#fff", fontSize: 16, borderWidth: 1, borderColor: theme.border },
  searchBtn: { marginTop: 20, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceElevated, alignItems: "center" },
  searchBtnText: { color: "#fff", fontWeight: "600" },
  foundCard: { marginTop: 16, flexDirection: "row", alignItems: "center", padding: 14, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.success },
  foundName: { color: "#fff", fontWeight: "700" },
  foundEmail: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  notFoundCard: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border },
  notFoundText: { color: "#fff", fontSize: 13, flex: 1 },
  err: { color: theme.primary, marginTop: 12, textAlign: "center" },
  saveBtn: { marginTop: 24, backgroundColor: theme.primary, paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 20 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },
  pbRow: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, marginBottom: 8 },
  pbName: { color: "#fff", fontWeight: "600" },
  pbPhone: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  empty: { alignItems: "center", padding: 40, marginTop: 60 },
  emptyTitle: { color: "#fff", fontWeight: "700", fontSize: 16, marginTop: 16 },
  emptySub: { color: theme.textSecondary, marginTop: 6, textAlign: "center" },
  linkBtn: { marginTop: 20 },
  linkText: { color: theme.primary, fontWeight: "600" },
});
