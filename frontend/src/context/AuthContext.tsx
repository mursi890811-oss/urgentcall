import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";
import { api, setAuthToken } from "@/src/api/client";
import { requestPushPermissionAndRegister } from "@/src/notifications/push";

export type AppUser = {
  user_id: string;
  email: string;
  full_name: string;
  phone: string;
  avatar_url?: string | null;
  provider?: string;
  settings?: any;
};

type AuthCtx = {
  user: AppUser | null;
  loading: boolean;
  token: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (full_name: string, phone: string, email: string, password: string) => Promise<void>;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

const TOKEN_KEY = "urgentcall_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStoredToken(): Promise<string | null> {
    if (Platform.OS === "web") {
      return await storage.getItem<string>(TOKEN_KEY, "");
    }
    return await storage.secureGet<string>(TOKEN_KEY, "");
  }

  async function saveToken(t: string) {
    if (Platform.OS === "web") {
      await storage.setItem(TOKEN_KEY, t);
    } else {
      await storage.secureSet(TOKEN_KEY, t);
    }
  }

  async function clearToken() {
    if (Platform.OS === "web") await storage.removeItem(TOKEN_KEY);
    else await storage.secureRemove(TOKEN_KEY);
  }

  async function hydrate() {
    setLoading(true);
    try {
      const stored = await loadStoredToken();
      if (stored) {
        setAuthToken(stored);
        const me = await api.get<AppUser>("/api/auth/me");
        setUser(me);
        setToken(stored);
        // Re-register on launch too: the FCM token can rotate independent of login state.
        requestPushPermissionAndRegister().catch(() => {});
      }
    } catch (e) {
      await clearToken();
      setAuthToken(null);
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    hydrate();
  }, []);

  async function applyAuth(resp: { access_token: string; user: AppUser }) {
    await saveToken(resp.access_token);
    setAuthToken(resp.access_token);
    setToken(resp.access_token);
    setUser(resp.user);
    // Non-blocking: an alert account should work even if push registration fails
    // (e.g. no Play Services on this device, or permission denied).
    requestPushPermissionAndRegister().catch(() => {});
  }

  async function signIn(email: string, password: string) {
    const resp = await api.post<{ access_token: string; user: AppUser }>(
      "/api/auth/login",
      { email, password }
    );
    await applyAuth(resp);
  }

  async function signUp(full_name: string, phone: string, email: string, password: string) {
    const resp = await api.post<{ access_token: string; user: AppUser }>(
      "/api/auth/register",
      { full_name, phone, email, password }
    );
    await applyAuth(resp);
  }

  async function signInWithGoogleIdToken(idToken: string) {
    const resp = await api.post<{ access_token: string; user: AppUser }>(
      "/api/auth/google",
      { id_token: idToken }
    );
    await applyAuth(resp);
  }

  async function signOut() {
    try { await api.post("/api/auth/logout", {}); } catch {}
    await clearToken();
    setAuthToken(null);
    setUser(null);
    setToken(null);
  }

  async function refresh() {
    try {
      const me = await api.get<AppUser>("/api/auth/me");
      setUser(me);
    } catch {}
  }

  return (
    <Ctx.Provider value={{ user, token, loading, signIn, signUp, signInWithGoogleIdToken, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
