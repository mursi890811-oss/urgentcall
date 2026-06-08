import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

export default function Blocked() {
  const router = useRouter();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try { setList(await api.get<any[]>("/api/users/me/blocked")); }
    catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function unblock(userId: string) {
    try { await api.delete(`/api/users/me/blocked/${userId}`); load(); } catch {}
  }

  return (
    <SafeAreaView style={styles.safe} testID="blocked-screen">
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} testID="blocked-back">
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Blocked Contacts</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? null : list.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="ban" size={42} color={theme.textTertiary} />
          <Text style={styles.emptyTitle}>You haven&apos;t blocked anyone</Text>
          <Text style={styles.emptySub}>Blocked people can&apos;t send you alerts.</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(it) => it.user_id}
          contentContainerStyle={{ padding: 20 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.full_name}</Text>
                <Text style={styles.meta}>{item.email}</Text>
              </View>
              <TouchableOpacity style={styles.unblockBtn} onPress={() => unblock(item.user_id)} testID="unblock-btn">
                <Text style={styles.unblockText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  topTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontWeight: "700", fontSize: 16, marginTop: 16 },
  emptySub: { color: theme.textSecondary, marginTop: 6, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14, marginBottom: 10 },
  name: { color: "#fff", fontWeight: "600" },
  meta: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  unblockBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.primary },
  unblockText: { color: theme.primary, fontWeight: "700", fontSize: 13 },
});
