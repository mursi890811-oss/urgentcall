import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const pulse = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.85, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      if (user) router.replace("/(tabs)/home");
      else router.replace("/login");
    }, 1400);
    return () => clearTimeout(t);
  }, [loading, user, router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <Animated.View style={[styles.logoCircle, { transform: [{ scale: pulse }] }]}>
        <Ionicons name="flash" size={64} color="#fff" />
      </Animated.View>
      <Text style={styles.title}>UrgentCall</Text>
      <Text style={styles.tagline}>Reach anyone, even on silent</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  logoCircle: {
    width: 140, height: 140, borderRadius: 70, backgroundColor: theme.primary,
    alignItems: "center", justifyContent: "center", marginBottom: 32,
    shadowColor: theme.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 30, elevation: 12,
  },
  title: { color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: 1, marginBottom: 8 },
  tagline: { color: theme.textSecondary, fontSize: 15 },
});
