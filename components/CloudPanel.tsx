
"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type CloudNote = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
};

type LocalNote = {
  id: string;
  title: string;
  content: string;
};

type Props = {
  currentNote: LocalNote | null;
  onRestore: (note: CloudNote) => void;
};

export default function CloudPanel({
  currentNote,
  onRestore,
}: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState<CloudNote[]>([]);
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

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }

    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from("notes")
        .select("id,title,content,updated_at")
        .order("updated_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setMessage(error.message);
      } else {
        setNotes(data ?? []);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  async function refreshNotes() {
    if (!user) return;

    const { data, error } = await supabase
      .from("notes")
      .select("id,title,content,updated_at")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    setNotes(data ?? []);
  }

  async function authenticate() {
    if (password.length < 8) {
      setMessage("Password must contain at least 8 characters.");
      return;
    }

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
            ? "Account created successfully."
            : "Check your email for the confirmation link."
        );
      } else {
        const { error } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

        if (error) throw error;

        setMessage("Signed in successfully.");
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

  async function backupNote() {
    if (!user || !currentNote) return;

    setBusy(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("notes")
        .upsert(
          {
            id: currentNote.id,
            owner_id: user.id,
            title: currentNote.title.slice(0, 200),
            content: currentNote.content,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

      if (error) throw error;

      await refreshNotes();
      setMessage("Note backed up to Supabase.");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Cloud backup failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteCloudNote(id: string) {
    if (!user) return;
    if (!window.confirm("Delete this cloud backup?")) return;

    setBusy(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("notes")
        .delete()
        .eq("id", id);

      if (error) throw error;

      await refreshNotes();
      setMessage("Cloud backup deleted. Local notes are unchanged.");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Deletion failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) setMessage(error.message);
    else {
      setNotes([]);
      setMessage("Signed out successfully.");
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-700 bg-slate-900 p-6">
      <h2 className="text-xl font-bold">
        SyncSpace Cloud
      </h2>

      <p className="mt-2 text-sm text-slate-400">
        Supabase Authentication + Cloud Backup
      </p>

      {message && (
        <p role="status" className="my-4 rounded-lg bg-slate-800 p-3 text-sm">
          {message}
        </p>
      )}

      {!authReady ? (
        <p className="mt-5 text-slate-400">
          Checking authentication...
        </p>
      ) : !user ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void authenticate();
          }}
          className="mt-6 space-y-4"
        >
          <h3 className="font-semibold">
            {register ? "Create Account" : "Sign In"}
          </h3>

          <input
            type="email"
            placeholder="Email address"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-slate-800 p-3 outline-none"
          />

          <input
            type="password"
            placeholder="Password"
            autoComplete={
              register ? "new-password" : "current-password"
            }
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-slate-800 p-3 outline-none"
          />

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 px-5 py-3 disabled:opacity-50"
          >
            {busy
              ? "Please wait..."
              : register
                ? "Register"
                : "Login"}
          </button>

          <button
            type="button"
            onClick={() => {
              setRegister(!register);
              setMessage("");
            }}
            className="ml-4 text-sm text-blue-400"
          >
            {register
              ? "Already registered? Login"
              : "Create an account"}
          </button>
        </form>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-green-400">
              Signed in: {user.email}
            </p>

            <button
              onClick={() => void logout()}
              className="rounded-lg bg-slate-700 px-4 py-2"
            >
              Logout
            </button>
          </div>

          <button
            onClick={() => void backupNote()}
            disabled={!currentNote || busy}
            className="rounded-lg bg-green-600 px-5 py-3 disabled:opacity-50"
          >
            Backup Current Note to Cloud
          </button>

          <div className="border-t border-slate-700 pt-5">
            <h3 className="mb-4 font-semibold">
              My Cloud Notes ({notes.length})
            </h3>

            {notes.length === 0 && (
              <p className="text-sm text-slate-400">
                No cloud backups yet.
              </p>
            )}

            <div className="space-y-3">
              {notes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-lg bg-slate-800 p-4"
                >
                  <p className="mb-3 font-medium">
                    {note.title}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        onRestore(note);
                        setMessage(
                          "Restored as a new local note."
                        );
                      }}
                      className="rounded bg-blue-600 px-3 py-2 text-sm"
                    >
                      Restore Locally
                    </button>

                    <button
                      onClick={() =>
                        void deleteCloudNote(note.id)
                      }
                      disabled={busy}
                      className="rounded bg-red-600 px-3 py-2 text-sm disabled:opacity-50"
                    >
                      Delete Backup
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
