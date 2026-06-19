import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";

type Tab = "signin" | "signup";

// Configure once at module load. Replace with your real Web Client ID from
// Google Cloud Console -> APIs & Services -> Credentials (OAuth client of type "Web application",
// NOT the Android client - the Android client is matched automatically via SHA-1 + package name).
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  offlineAccess: false,
});

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signUp, signInWithGoogleIdToken } = useAuth();
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
      if (Platform.OS === "web") {
        setErr("Google sign-in on web is not set up yet - use email & password.");
        return;
      }
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      // signIn() resolves even on user cancellation in newer versions; check the type field.
      if (response.type !== "success") { setLoading(false); return; }
      const idToken = response.data?.idToken;
      if (!idToken) throw new Error("No ID token returned from Google");
      await signInWithGoogleIdToken(idToken);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      if (e?.code === statusCodes.SIGN_IN_CANCELLED) {
        // user closed the picker - not an error worth showing
      } else if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setErr("Google Play Services not available on this device");
      } else {
        setErr(e.message || "Google sign-in failed");
      }
    } finally { setLoading(false); }
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
