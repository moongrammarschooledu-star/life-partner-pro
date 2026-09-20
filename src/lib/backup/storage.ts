import { put, del } from "@vercel/blob";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { dirname, join, resolve } from "path";
import { pathToFileURL, fileURLToPath } from "url";

// Backup object storage (spec §6). Production writes ciphertext to Vercel Blob
// (preferably a SEPARATE store via BACKUP_BLOB_READ_WRITE_TOKEN). For local
// development and tests, BACKUP_LOCAL_DIR redirects everything to a folder on
// disk so the whole backup → verify → restore path can be exercised without a
// cloud account. The local sink is REFUSED in production so it can never
// silently replace real off-site storage.

function localDir(): string | null {
  const dir = process.env.BACKUP_LOCAL_DIR?.trim();
  if (!dir) return null;
  const isProd = process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (isProd) throw new Error("BACKUP_LOCAL_DIR is not allowed in production.");
  return resolve(dir);
}

export function usingLocalSink(): boolean {
  try {
    return localDir() !== null;
  } catch {
    return false;
  }
}

export async function storeBackupObject(path: string, data: Buffer): Promise<string> {
  const dir = localDir();
  if (dir) {
    const target = join(dir, path.replace(/^\/+/, ""));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    return pathToFileURL(target).toString();
  }
  const blob = await put(path, data, {
    access: "public", // ciphertext only; the URL is unguessable and never exposed by any API
    contentType: "application/octet-stream",
    addRandomSuffix: true,
    token: process.env.BACKUP_BLOB_READ_WRITE_TOKEN || undefined,
  });
  return blob.url;
}

export async function fetchBackupObject(url: string): Promise<Buffer> {
  if (url.startsWith("file://")) {
    if (!usingLocalSink()) throw new Error("Local backup objects are not readable in this environment.");
    return readFile(fileURLToPath(url));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backup object could not be downloaded (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteBackupObject(url: string): Promise<void> {
  if (url.startsWith("file://")) {
    if (usingLocalSink()) await rm(fileURLToPath(url), { force: true });
    return;
  }
  await del(url, { token: process.env.BACKUP_BLOB_READ_WRITE_TOKEN || undefined }).catch(() => undefined);
}
