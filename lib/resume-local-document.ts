"use client";

import { createTailoredDocxArrayBuffer } from "@/lib/resume-docx";
import type { CandidateProfile, ResumeBulletRewrite, ResumeDocumentMetadata, ResumeEditOperation, ResumeLayoutAdjustment } from "@/lib/types";

const dbName = "stealth-resume-documents";
const storeName = "documents";
const localDocumentKey = "stealth.localResumeDocument";

export type LocalResumeDocumentMetadata = ResumeDocumentMetadata & {
  localKey: string;
};

export async function storeLocalResumeDocument(file: File, textHash: string): Promise<LocalResumeDocumentMetadata | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  if (!isDocxFile(file)) return null;

  const db = await openResumeDocumentDb();
  const localKey = `${Date.now()}-${sanitizeName(file.name || "resume.docx")}`;
  const buffer = await file.arrayBuffer();

  await runStoreRequest(db, "readwrite", (store) =>
    store.put({
      key: localKey,
      fileName: file.name,
      fileType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      uploadedAt: new Date().toISOString(),
      buffer
    })
  );

  const metadata: LocalResumeDocumentMetadata = {
    storagePath: `indexeddb://${localKey}`,
    fileName: file.name,
    fileType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
    textHash,
    exactLayoutSupported: true,
    localKey
  };

  window.localStorage.setItem(localDocumentKey, JSON.stringify(metadata));
  return metadata;
}

export function getLocalResumeDocumentMetadata(): LocalResumeDocumentMetadata | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(localDocumentKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalResumeDocumentMetadata>;
    if (!parsed.localKey || !parsed.fileName || !parsed.exactLayoutSupported) return null;
    return parsed as LocalResumeDocumentMetadata;
  } catch {
    window.localStorage.removeItem(localDocumentKey);
    return null;
  }
}

export function getBestResumeDocument(profile: CandidateProfile): ResumeDocumentMetadata | LocalResumeDocumentMetadata | null {
  const profileDocument = profile.resumeDocument ?? null;
  const localDocument = getLocalResumeDocumentMetadata();

  if (profileDocument?.storagePath?.startsWith("indexeddb://")) {
    if (!localDocument) return null;
    if (localDocument.textHash && profileDocument.textHash && localDocument.textHash !== profileDocument.textHash) return null;
    return localDocument;
  }

  if (profileDocument?.exactLayoutSupported) return profileDocument;

  if (!localDocument) return profileDocument;
  if (localDocument.textHash && profileDocument?.textHash && localDocument.textHash !== profileDocument.textHash) {
    return profileDocument;
  }

  return localDocument;
}

export async function createTailoredDocxFromLocalDocument(input: {
  editOperations?: ResumeEditOperation[];
  rewrites?: ResumeBulletRewrite[];
  layoutAdjustment?: ResumeLayoutAdjustment;
}) {
  const localDocument = getLocalResumeDocumentMetadata();
  if (!localDocument) throw new Error("No locally stored DOCX resume was found.");

  const db = await openResumeDocumentDb();
  const record = await runStoreRequest<StoredResumeDocument | undefined>(db, "readonly", (store) => store.get(localDocument.localKey));
  if (!record?.buffer) throw new Error("No locally stored DOCX resume was found.");

  return createTailoredDocxArrayBuffer(record.buffer, input);
}

function openResumeDocumentDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("Local resume storage is unavailable."));
      return;
    }

    const request = window.indexedDB.open(dbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "key" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local resume storage."));
  });
}

function runStoreRequest<T = unknown>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not access local resume storage."));
  });
}

function isDocxFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function sanitizeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "resume.docx";
}

type StoredResumeDocument = {
  key: string;
  fileName: string;
  fileType: string;
  uploadedAt: string;
  buffer: ArrayBuffer;
};
