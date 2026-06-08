import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";

type Tab = "signin" | "signup";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signUp, signInWithGoogleSession } = useAuth();
  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!email || !password) { setErr("Enter email & password"); return; }
    setErr(null); setLoading(true);
    try { await signIn(email.trim(), password); router.replace("/(tabs)/home"); }
    catch (e: any) { setErr(e.message || "Login failed"); }
    finally { setLoading(false); }
  }

  async function handleSignUp() {
    if (!fullName || !phone || !email || !password) { setErr("Fill all fields"); return; }
    if (password.length < 6) { setErr("Password must be 6+ chars"); return; }
    if (password !== confirm) { setErr("Passwords don't match"); return; }
    setErr(null); setLoading(true);
    try { await signUp(fullName.trim(), phone.trim(), email.trim(), password); router.replace("/(tabs)/home"); }
    catch (e: any) { setErr(e.message || "Sign up failed"); }
    finally { setLoading(false); }
  }

  async function handleGoogle() {
    setErr(null); setLoading(true);
    try {
      const redirectUrl = Platform.OS === "web"
        ? (typeof window !== "undefined" ? window.location.origin + "/login" : "")
        : Linking.createURL("login");
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

      if (Platform.OS === "web") {
        // Web: redirect; after return parse session_id
        if (typeof window !== "undefined") {
          // Check if already returning with session_id
          const url = new URL(window.location.href);
          const sid = url.hash.includes("session_id=")
            ? new URLSearchParams(url.hash.slice(1)).get("session_id")
            : url.searchParams.get("session_id");
          if (sid) {
            await signInWithGoogleSession(sid);
            window.history.replaceState(null, "", url.pathname);
            router.replace("/(tabs)/home");
            return;
          }
          window.location.href = authUrl;
        }
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type !== "success" || !result.url) { setLoading(false); return; }
      const parsed = new URL(result.url);
      const sid = parsed.hash.includes("session_id=")
        ? new URLSearchParams(parsed.hash.slice(1)).get("session_id")
        : parsed.searchParams.get("session_id");
      if (!sid) throw new Error("No session id returned");
      await signInWithGoogleSession(sid);
      router.replace("/(tabs)/home");
    } catch (e: any) { setErr(e.message || "Google sign-in failed"); }
    finally { setLoading(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]} testID="login-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.brandIcon}><Ionicons name="flash" size={28} color="#fff" /></View>
            <Text style={styles.brandText}>UrgentCall</Text>
          </View>

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === "signin" && styles.tabActive]}
              onPress={() => setTab("signin")}
              testID="tab-signin"
            >
              <Text style={[styles.tabText, tab === "signin" && styles.tabTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === "signup" && styles.tabActive]}
              onPress={() => setTab("signup")}
              testID="tab-signup"
            >
              <Text style={[styles.tabText, tab === "signup" && styles.tabTextActive]}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {tab === "signup" && (
            <>
              <TextInput
                style={styles.input} placeholder="Full Name" placeholderTextColor={theme.textTertiary}
                value={fullName} onChangeText={setFullName} testID="signup-fullname-input"
              />
              <TextInput
                style={styles.input} placeholder="Phone Number" placeholderTextColor={theme.textTertiary}
                value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="signup-phone-input"
              />
            </>
          )}

          <TextInput
            style={styles.input} placeholder="Email" placeholderTextColor={theme.textTertiary}
            value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
            testID={tab === "signin" ? "login-email-input" : "signup-email-input"}
          />
          <View style={styles.pwRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Password" placeholderTextColor={theme.textTertiary}
              value={password} onChangeText={setPassword} secureTextEntry={!showPw}
              testID={tab === "signin" ? "login-password-input" : "signup-password-input"}
            />
            <TouchableOpacity onPress={() => setShowPw(!showPw)} style={styles.eyeBtn} testID="password-toggle">
              <Ionicons name={showPw ? "eye-off" : "eye"} size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {tab === "signup" && (
            <TextInput
              style={styles.input} placeholder="Confirm Password" placeholderTextColor={theme.textTertiary}
              value={confirm} onChangeText={setConfirm} secureTextEntry={!showPw}
              testID="signup-confirm-input"
            />
          )}

          {err && <Text style={styles.err}>{err}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
            onPress={tab === "signin" ? handleSignIn : handleSignUp}
            disabled={loading}
            testID={tab === "signin" ? "login-submit-button" : "signup-submit-button"}
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.primaryBtnText}>{tab === "signin" ? "Sign In" : "Create Account"}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.divider} /><Text style={styles.dividerText}>OR</Text><View style={styles.divider} />
          </View>

          <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle} disabled={loading} testID="google-button">
            <Ionicons name="logo-google" size={20} color="#fff" />
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 24, paddingBottom: 48 },
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginVertical: 32, gap: 12 },
  brandIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
  brandText: { color: "#fff", fontSize: 24, fontWeight: "800" },
  tabs: { flexDirection: "row", backgroundColor: theme.surface, borderRadius: 12, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: theme.surfaceElevated },
  tabText: { color: theme.textSecondary, fontWeight: "600", fontSize: 14 },
  tabTextActive: { color: "#fff" },
  input: {
    backgroundColor: theme.surfaceElevated, borderRadius: 12, padding: 16, color: "#fff", fontSize: 16,
    borderWidth: 1, borderColor: theme.border, marginBottom: 12,
  },
  pwRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  eyeBtn: { padding: 12, marginLeft: 4 },
  err: { color: theme.primary, textAlign: "center", marginBottom: 12, fontSize: 13 },
  primaryBtn: {
    backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: 20 },
  divider: { flex: 1, height: 1, backgroundColor: theme.border },
  dividerText: { color: theme.textSecondary, marginHorizontal: 12, fontSize: 12 },
  googleBtn: {
    flexDirection: "row", gap: 12, backgroundColor: theme.surfaceElevated, borderRadius: 12, paddingVertical: 16,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border,
  },
  googleBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
