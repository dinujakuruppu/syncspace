
"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { fromUint8Array, toUint8Array } from "js-base64";
import { supabase } from "@/lib/supabase";

type NoteInfo = {
  title: string;
  createdAt: number;
};

type NoteItem = NoteInfo & {
  id: string;
};

function createNote(
  doc: Y.Doc,
  title = "Untitled Note",
  content = ""
) {
  const id = crypto.randomUUID();

  doc.transact(() => {
    const text = new Y.Text();

    doc.getMap<Y.Text>("texts").set(id, text);
    doc.getMap<NoteInfo>("metadata").set(id, {
      title,
      createdAt: Date.now(),
    });

    if (content) text.insert(0, content);
  });

  return id;
}

export default function SyncWorkspace({
  userId,
}: {
  userId: string;
}) {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState("Starting...");
  const [message, setMessage] = useState("");

  const docRef = useRef<Y.Doc | null>(null);
  const syncNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let loaded = false;
    let syncing = false;
    let dirty = true;
    let version = 0;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const doc = new Y.Doc();
    docRef.current = doc;

    const metadata = doc.getMap<NoteInfo>("metadata");

    function refreshNotes() {
      if (!active) return;

      const list = Array.from(metadata.entries())
        .map(([id, info]) => ({ id, ...info }))
        .sort((a, b) => b.createdAt - a.createdAt);

      setNotes(list);
      setActiveId((previous) =>
        previous && metadata.has(previous)
          ? previous
          : list[0]?.id ?? null
      );
    }

    function schedule() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void sync(), 900);
    }

    function handleUpdate(_update: Uint8Array, origin: unknown) {
      if (origin === "cloud") return;

      version++;
      dirty = true;
      setStatus("Pending changes");
      schedule();
    }

    async function pullCloudUpdates() {
      const batchSize = 200;
      let offset = 0;

      while (active) {
        const { data, error } = await supabase
          .from("yjs_updates")
          .select("payload")
          .eq("owner_id", userId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + batchSize - 1);

        if (error) throw error;
        if (!active) return;

        for (const row of data ?? []) {
          Y.applyUpdate(
            doc,
            toUint8Array(row.payload),
            "cloud"
          );
        }

        if (!data || data.length < batchSize) break;

        offset += batchSize;
      }
    }

    async function sync() {
      if (!active || !loaded || syncing) return;

      if (!navigator.onLine) {
        setStatus("Offline - saved locally");
        return;
      }

      syncing = true;
      let succeeded = false;
      setStatus("Syncing...");

      try {
        if (dirty) {
          const currentVersion = version;

          const payload = fromUint8Array(
            Y.encodeStateAsUpdate(doc)
          );

          const { error } = await supabase
            .from("yjs_updates")
            .insert({
              owner_id: userId,
              payload,
            });

          if (error) throw error;
          if (!active) return;

          if (version === currentVersion) {
            dirty = false;
          }
        }

        await pullCloudUpdates();

        if (!active) return;

        succeeded = true;
        setStatus(
          dirty ? "Pending changes" : "Cloud synced"
        );
      } catch (err) {
        if (active) {
          setStatus("Cloud sync failed - local copy retained");
          console.error("SyncSpace sync error:", err);
        }
      } finally {
        syncing = false;

        if (active && succeeded && dirty) {
          schedule();
        }
      }
    }

    metadata.observe(refreshNotes);

    function goOnline() {
      setOnline(true);
      void sync();
    }

    function goOffline() {
      setOnline(false);
      setStatus("Offline - saved locally");
    }

    setOnline(navigator.onLine);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    syncNowRef.current = () => void sync();

    async function initialize() {
      try {
        const { IndexeddbPersistence } =
          await import("y-indexeddb");

        if (!active) return;

        const persistence = new IndexeddbPersistence(
          `syncspace-user-${userId}-v1`,
          doc
        );

        await persistence.whenSynced;
        if (!active) return;

        doc.on("update", handleUpdate);

        loaded = true;
        refreshNotes();
        setReady(true);

        // Upload any local state, including offline edits
        // saved during a previous session.
        await sync();

        poll = setInterval(() => {
          void sync();
        }, 12000);
      } catch (err) {
        if (active) {
          console.error(err);
          setMessage("Could not initialize local storage.");
          setStatus("Local storage error");
        }
      }
    }

    void initialize();

    return () => {
      active = false;
      loaded = false;

      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);

      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);

      metadata.unobserve(refreshNotes);
      doc.off("update", handleUpdate);

      syncNowRef.current = () => {};

      if (docRef.current === doc) {
        docRef.current = null;
      }

      doc.destroy();
    };
  }, [userId]);

  useEffect(() => {
    if (!ready) return;

    const text = activeId
      ? docRef.current
          ?.getMap<Y.Text>("texts")
          .get(activeId)
      : null;

    if (!text) {
      setContent("");
      return;
    }

    const refresh = () => setContent(text.toString());

    text.observe(refresh);
    refresh();

    return () => text.unobserve(refresh);
  }, [activeId, ready]);

  function addNote() {
    if (!docRef.current || !ready) return;

    const id = createNote(docRef.current);
    setActiveId(id);
  }

  function renameNote(title: string) {
    if (!activeId || !docRef.current) return;

    const metadata =
      docRef.current.getMap<NoteInfo>("metadata");

    const current = metadata.get(activeId);
    if (!current) return;

    metadata.set(activeId, {
      ...current,
      title,
    });
  }

  function deleteNote() {
    if (!activeId || !docRef.current) return;

    if (!confirm("Delete this note from the workspace?")) {
      return;
    }

    const doc = docRef.current;

    doc.transact(() => {
      doc.getMap<NoteInfo>("metadata").delete(activeId);
      doc.getMap<Y.Text>("texts").delete(activeId);
    });
  }

  function updateContent(next: string) {
    if (!activeId || !docRef.current) return;

    const text = docRef.current
      .getMap<Y.Text>("texts")
      .get(activeId);

    if (!text) return;

    const old = text.toString();
    let start = 0;

    while (
      start < old.length &&
      start < next.length &&
      old[start] === next[start]
    ) {
      start++;
    }

    let oldEnd = old.length;
    let newEnd = next.length;

    while (
      oldEnd > start &&
      newEnd > start &&
      old[oldEnd - 1] === next[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }

    docRef.current.transact(() => {
      text.delete(start, oldEnd - start);
      text.insert(start, next.slice(start, newEnd));
    });
  }

  async function importOldBrowserNotes() {
    const doc = docRef.current;
    if (!doc || !ready) return;

    const owner = localStorage.getItem(
      "syncspace-legacy-import-owner"
    );

    if (owner && owner !== userId) {
      setMessage(
        "Legacy notes were already assigned to another account."
      );
      return;
    }

    if (!confirm("Import previous browser notes into this account?")) {
      return;
    }

    const oldDoc = new Y.Doc();

    try {
      const { IndexeddbPersistence } =
        await import("y-indexeddb");

      const oldPersistence = new IndexeddbPersistence(
        "syncspace-multiple-notes-v1",
        oldDoc
      );

      try {
        await oldPersistence.whenSynced;

        if (oldDoc.getMap("metadata").size === 0) {
          setMessage("No previous browser notes found.");
          return;
        }

        if (docRef.current !== doc) return;

        Y.applyUpdate(
          doc,
          Y.encodeStateAsUpdate(oldDoc)
        );

        localStorage.setItem(
          "syncspace-legacy-import-owner",
          userId
        );

        setMessage("Previous browser notes imported.");
      } finally {
        await oldPersistence.destroy();
      }
    } catch (err) {
      console.error(err);
      setMessage("Browser note import failed.");
    } finally {
      oldDoc.destroy();
    }
  }

  async function importOldCloudBackups() {
    const doc = docRef.current;
    if (!doc || !ready || !navigator.onLine) return;

    try {
      const { data, error } = await supabase
        .from("notes")
        .select("id,title,content,created_at");

      if (error) throw error;
      if (docRef.current !== doc) return;

      const metadata = doc.getMap<NoteInfo>("metadata");
      const texts = doc.getMap<Y.Text>("texts");

      let imported = 0;

      doc.transact(() => {
        for (const row of data ?? []) {
          if (metadata.has(row.id)) continue;

          const text = new Y.Text();

          texts.set(row.id, text);
          metadata.set(row.id, {
            title: row.title,
            createdAt:
              Date.parse(row.created_at) || Date.now(),
          });

          if (row.content) text.insert(0, row.content);
          imported++;
        }
      });

      setMessage(`${imported} cloud backup(s) imported.`);
    } catch (err) {
      console.error(err);
      setMessage("Cloud backup import failed.");
    }
  }

  const selected = notes.find((n) => n.id === activeId);

  return (
    <div className="flex min-h-[calc(100vh-80px)] flex-col md:flex-row">
      <aside className="w-full border-b border-slate-700 bg-slate-900 p-5 md:w-80 md:border-b-0 md:border-r">
        <h2 className="text-xl font-bold">My Notes</h2>

        <button
          onClick={addNote}
          disabled={!ready}
          className="mt-5 w-full rounded-lg bg-blue-600 p-3 disabled:opacity-50"
        >
          + Create New Note
        </button>

        <p className="mt-6 mb-3 text-sm text-slate-400">
          MY NOTES ({notes.length})
        </p>

        <div className="space-y-2">
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => setActiveId(note.id)}
              className={`w-full rounded-lg p-3 text-left ${
                activeId === note.id
                  ? "bg-blue-600"
                  : "bg-slate-800 hover:bg-slate-700"
              }`}
            >
              <span className="block truncate">
                {note.title || "Untitled Note"}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex-1 p-5 md:p-10">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">My Workspace</h2>

            <span className={
              online ? "text-green-400" : "text-amber-400"
            }>
              {online ? "● Network Online" : "● Network Offline"}
            </span>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">{status}</p>

              <button
                onClick={() => syncNowRef.current()}
                disabled={!ready || !online}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm disabled:opacity-50"
              >
                Sync Now
              </button>
            </div>
          </div>

          {message && (
            <p role="status" className="rounded-lg bg-slate-800 p-3 text-sm">
              {message}
            </p>
          )}

          {selected ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
              <div className="mb-5 flex gap-3">
                <input
                  value={selected.title}
                  onChange={(e) => renameNote(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xl font-bold outline-none"
                />

                <button
                  onClick={deleteNote}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm"
                >
                  Delete
                </button>
              </div>

              <textarea
                key={activeId}
                value={content}
                onChange={(e) => updateContent(e.target.value)}
                placeholder="Write your notes here..."
                className="h-96 w-full resize-y rounded-lg bg-slate-800 p-4 outline-none"
              />

              <p className="mt-4 text-sm text-slate-400">
                Local: Yjs + IndexedDB
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700 p-10 text-center text-slate-400">
              {ready
                ? "Create a note or import your previous notes."
                : "Loading local workspace..."}
            </div>
          )}

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
            <h3 className="text-lg font-bold">Import Existing Notes</h3>

            <p className="mt-2 text-sm text-slate-400">
              Import notes saved before automatic synchronization.
              Existing sources will not be deleted.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={() => void importOldBrowserNotes()}
                disabled={!ready}
                className="rounded-lg bg-blue-600 px-4 py-3 text-sm disabled:opacity-50"
              >
                Import Old Browser Notes
              </button>

              <button
                onClick={() => void importOldCloudBackups()}
                disabled={!ready || !online}
                className="rounded-lg bg-slate-700 px-4 py-3 text-sm disabled:opacity-50"
              >
                Import Old Cloud Backups
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
