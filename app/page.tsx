
"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import SyncWorkspace from "@/components/SyncWorkspace";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        setAuthReady(true);
      });

    return () => subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      if (register) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;

        setMessage(
          data.session
            ? "Account created."
            : "Check your email to verify your account."
        );
      } else {
        const { error } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
        if (error) throw error;
      }

      setPassword("");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Authentication failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(error.message);
  }

  if (!authReady) {
    return (
      <main className="min-h-screen bg-slate-950 p-10 text-white">
        Checking session...
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5 text-white">
        <form
          onSubmit={submit}
          className="w-full max-w-md space-y-5 rounded-xl border border-slate-700 bg-slate-900 p-8"
        >
          <h1 className="text-3xl font-bold">SyncSpace</h1>
          <p className="text-slate-400">
            Offline-first collaborative workspace
          </p>

          {message && (
            <p role="status" className="rounded bg-slate-800 p-3 text-sm">
              {message}
            </p>
          )}

          <input
            type="email"
            required
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-slate-800 p-3"
          />

          <input
            type="password"
            required
            minLength={8}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-slate-800 p-3"
          />

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 p-3 font-semibold disabled:opacity-50"
          >
            {busy ? "Please wait..." : register ? "Register" : "Login"}
          </button>

          <button
            type="button"
            onClick={() => {
              setRegister(!register);
              setMessage("");
            }}
            className="text-sm text-blue-400"
          >
            {register
              ? "Already have an account? Login"
              : "Create an account"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 p-4">
        <div>
          <h1 className="text-2xl font-bold">SyncSpace</h1>
          <p className="text-xs text-slate-400">{user.email}</p>
        </div>

        <button
          onClick={logout}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm"
        >
          Logout
        </button>
      </header>

      <SyncWorkspace key={user.id} userId={user.id} />
    </main>
  );
}
