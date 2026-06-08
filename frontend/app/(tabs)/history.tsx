import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

type Alert = {
  id: string; sender_name: string; receiver_name: string; status: string;
  created_at: string; direction: "incoming" | "outgoing"; message: string;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "received", label: "Received" },
  { key: "missed", label: "Missed" },
];

function timeAgo(iso: string) {
  const d = new Date(iso); const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function statusColor(s: string) {
  if (s === "acknowledged") return theme.success;
  if (s === "missed") return theme.primary;
  if (s === "dismissed") return theme.warn;
  return theme.textSecondary;
}

export default function History() {
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState<Alert[]>([]);

  const load = useCallback(async () => {
    try { setItems(await api.get<Alert[]>(`/api/alerts?filter=${filter}`)); } catch {}
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID="history-screen">
      <View style={styles.header}><Text style={styles.title}>History</Text></View>

      <View style={styles.filters} testID="history-filter-tabs">
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
            testID={`filter-${f.key}`}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: 20, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={42} color={theme.textTertiary} />
            <Text style={styles.emptyText}>No alerts yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row} testID="history-list-item">
            <View style={[styles.dirIcon, { backgroundColor: item.direction === "incoming" ? theme.surfaceElevated : theme.primary }]}>
              <Ionicons name={item.direction === "incoming" ? "arrow-down" : "arrow-up"} size={16} color="#fff" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.rowName}>{item.direction === "incoming" ? item.sender_name : item.receiver_name}</Text>
              <Text style={styles.rowTime}>{timeAgo(item.created_at)}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: statusColor(item.status) + "22", borderColor: statusColor(item.status) }]}>
              <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{item.status}</Text>
            </View>
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
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 8, marginBottom: 4 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, flexShrink: 0 },
  filterChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  filterText: { color: theme.textSecondary, fontSize: 13, fontWeight: "600" },
  filterTextActive: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: theme.surface, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, marginBottom: 10 },
  dirIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowName: { color: "#fff", fontWeight: "600", fontSize: 15 },
  rowTime: { color: theme.textSecondary, fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  empty: { alignItems: "center", paddingTop: 60 },
  emptyText: { color: theme.textSecondary, marginTop: 12 },
});
