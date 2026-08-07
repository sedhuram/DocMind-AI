"use client";

import { useEffect, useState } from "react";
import { LogIn, UserCheck, ShieldCheck, X } from "lucide-react";
import { apiClient, type UserProfile } from "@/lib/api-client";
import { useChat } from "@/lib/chat-context";

export function GoogleSignInBadge() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [loading, setLoading] = useState(false);

  const { addToast } = useChat();

  useEffect(() => {
    const savedUser = localStorage.getItem("docmind_user");
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        setUser(null);
      }
    } else {
      // Default to System Admin user
      const defaultUser: UserProfile = {
        id: "user-admin-default",
        email: "admin@docmind.ai",
        name: "System Administrator",
        avatar_url: "https://lh3.googleusercontent.com/a/default-user=s96-c",
        role: "admin",
      };
      setUser(defaultUser);
    }
  }, []);

  const handleSignIn = async (email: string, name: string) => {
    setLoading(true);
    try {
      const res = await apiClient.googleSignIn(email, name);
      localStorage.setItem("docmind_auth_token", res.token);
      localStorage.setItem("docmind_user", JSON.stringify(res.user));
      setUser(res.user);
      addToast(`Signed in as ${res.user.name}`, "success");
      setIsOpen(false);
    } catch {
      addToast("Failed to sign in.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        title="Google Account & Sign In"
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] font-bold text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-all cursor-pointer shadow-2xs"
      >
        <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-tr from-blue-500 via-red-500 to-yellow-500 text-[10px] font-bold text-white shadow-2xs">
          {user?.name ? user.name[0].toUpperCase() : "G"}
        </div>
        <div className="flex flex-col items-start leading-none">
          <span className="text-[10.5px] font-bold max-w-[120px] truncate">{user?.name || "Sign In"}</span>
          <span className="text-[8.5px] text-[var(--foreground)]/50 font-mono">{user?.role === "admin" ? "ADMIN" : "USER"}</span>
        </div>
      </button>

      {/* Google Sign-In Simulation Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-[fadeIn_0.15s_ease-out]">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl relative">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
            >
              <X size={16} />
            </button>

            <div className="flex flex-col items-center text-center mb-6">
              <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-blue-500 via-red-500 to-yellow-500 p-0.5 mb-3 flex items-center justify-center shadow-md">
                <div className="h-full w-full bg-[var(--surface)] rounded-full flex items-center justify-center">
                  <span className="text-xl font-black text-[var(--foreground)]">G</span>
                </div>
              </div>
              <h3 className="text-base font-bold text-[var(--foreground)]">Google Workspace Sign-In</h3>
              <p className="text-xs text-[var(--foreground)]/50 mt-1">Authenticate for session tracking and audit accountability</p>
            </div>

            {/* Quick Demo Accounts */}
            <div className="space-y-2 mb-4">
              <button
                onClick={() => handleSignIn("admin@docmind.ai", "System Administrator")}
                disabled={loading}
                className="w-full p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-between text-xs font-bold transition-all"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} />
                  <span>Sign in as Admin (admin@docmind.ai)</span>
                </div>
                <span className="text-[10px] uppercase font-mono">ADMIN</span>
              </button>

              <button
                onClick={() => handleSignIn("interviewer@panel.com", "Interview Panel Reviewer")}
                disabled={loading}
                className="w-full p-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:border-[var(--accent)]/40 flex items-center justify-between text-xs font-bold transition-all text-[var(--foreground)]"
              >
                <div className="flex items-center gap-2">
                  <UserCheck size={16} className="text-emerald-500" />
                  <span>Sign in as Interviewer (interviewer@panel.com)</span>
                </div>
                <span className="text-[10px] uppercase font-mono text-[var(--foreground)]/50">USER</span>
              </button>
            </div>

            <div className="relative my-4 flex items-center justify-center">
              <div className="absolute inset-0 border-t border-[var(--border)]" />
              <span className="relative bg-[var(--surface)] px-2 text-[10px] uppercase font-bold text-[var(--foreground)]/40">Or Custom Profile</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[var(--foreground)] mb-1">Email Address</label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full bg-[var(--background)] border border-[var(--border)] rounded p-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--foreground)] mb-1">Full Name</label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="John Doe"
                  className="w-full bg-[var(--background)] border border-[var(--border)] rounded p-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <button
                onClick={() => handleSignIn(emailInput || "user@custom.com", nameInput || "Custom User")}
                disabled={loading}
                className="w-full py-2 bg-[var(--accent)] text-white rounded-lg font-bold text-xs hover:bg-[var(--accent)]/90 transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer"
              >
                <LogIn size={14} />
                <span>Continue with Google</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
