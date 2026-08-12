// drive.js
import { getGoogleAccessToken } from "./google-auth.js";

async function driveFetch(env, path, options = {}) {
  const token = await getGoogleAccessToken(env);
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API error (${res.status}): ${text}`);
  }
  return res.json();
}

// מוצא תיקייה לפי שם בתוך תיקיית-אב, ואם אין - יוצר אותה
export async function ensureFolder(env, name, parentId) {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const found = await driveFetch(env, `/files?q=${q}&fields=files(id,name)`);
  if (found.files && found.files.length > 0) return found.files[0].id;

  const token = await getGoogleAccessToken(env);
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const created = await res.json();
  return created.id;
}

// מעלה קובץ (bytes) לתוך תיקייה, מחזיר {id, webViewLink}
export async function uploadFile(env, { name, mimeType, bytes, parentId }) {
  const token = await getGoogleAccessToken(env);
  const metadata = { name, parents: [parentId] };

  const boundary = "smartexpense-boundary-" + crypto.randomUUID();
  const encoder = new TextEncoder();
  const parts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ];
  const head = encoder.encode(parts.join(""));
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Blob([head, bytes, tail]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) throw new Error("Drive upload failed: " + (await res.text()));
  return res.json();
}

// מזיז קובץ מתיקייה אחת לאחרת (מחליף parent)
export async function moveFile(env, fileId, newParentId) {
  const token = await getGoogleAccessToken(env);
  const meta = await driveFetch(env, `/files/${fileId}?fields=parents`);
  const oldParents = (meta.parents || []).join(",");
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${newParentId}&removeParents=${oldParents}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error("Drive move failed: " + (await res.text()));
  return res.json();
}

// מוריד קובץ (לצורך OCR)
export async function downloadFile(env, fileId) {
  const token = await getGoogleAccessToken(env);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Drive download failed: " + (await res.text()));
  return res.arrayBuffer();
}
