import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

type Contact = {
  id: string; name: string; phone: string; email?: string;
  contact_user_id?: string | null; status: string;
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function Contacts() {
  const router = useRouter();
  const [items, setItems] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try { setItems(await api.get<Contact[]>("/api/contacts")); } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function remove(c: Contact) {
    const doRemove = async () => {
      try { await api.delete(`/api/contacts/${c.id}`); load(); } catch {}
    };
    if (Platform.OS === "web") doRemove();
    else Alert.alert("Remove contact", `Remove ${c.name} from trusted list?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: doRemove },
    ]);
  }

  const filtered = items.filter((c) =>
    !query || c.name.toLowerCase().includes(query.toLowerCase()) || c.phone.includes(query)
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="contacts-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Trusted Contacts</Text>
        <Text style={styles.subtitle}>People who can reach you instantly</Text>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push("/add-contact?mode=phonebook" as any)} testID="add-from-phonebook">
          <Ionicons name="phone-portrait" size={18} color="#fff" />
          <Text style={styles.actionText}>From Phonebook</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push("/add-contact?mode=manual" as any)} testID="add-manual">
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.actionText}>Add Manually</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          style={styles.searchInput} placeholder="Search contacts" placeholderTextColor={theme.textTertiary}
          value={query} onChangeText={setQuery} testID="contacts-search-input"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color={theme.textTertiary} />
            <Text style={styles.emptyTitle}>No trusted contacts yet</Text>
            <Text style={styles.emptySub}>Add people you trust so they can reach you in emergencies.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row} testID="contact-row">
            <View style={styles.rowAvatar}><Text style={styles.rowAvatarText}>{initials(item.name)}</Text></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowPhone}>{item.phone}</Text>
            </View>
            <View style={[styles.dot, { backgroundColor: item.status === "active" ? theme.success : theme.textTertiary }]} />
            <TouchableOpacity onPress={() => remove(item)} style={styles.removeBtn} testID="contact-remove">
              <Ionicons name="trash-outline" size={18} color={theme.primary} />
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  header: { padding: 20, paddingBottom: 8 },
  title: { color: "#fff", fontSize: 26, fontWeight: "800" },
  subtitle: { color: theme.textSecondary, marginTop: 4 },
  actionsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20 },
  actionBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: theme.surfaceElevated, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 14 },
  actionText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 20, marginTop: 12 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },
  empty: { alignItems: "center", paddingTop: 60 },
  emptyTitle: { color: "#fff", fontWeight: "700", fontSize: 16, marginTop: 16 },
  emptySub: { color: theme.textSecondary, fontSize: 13, marginTop: 6, textAlign: "center", paddingHorizontal: 24 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, marginBottom: 10 },
  rowAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.surfaceElevated, alignItems: "center", justifyContent: "center" },
  rowAvatarText: { color: "#fff", fontWeight: "700" },
  rowName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowPhone: { color: theme.textSecondary, fontSize: 13, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  removeBtn: { padding: 6 },
});
