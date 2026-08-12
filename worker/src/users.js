// users.js
import { ensureFolder } from "./drive.js";

const ADMIN_PASSWORD = "meny"; // סיסמת המנהל הקבועה לאישור יצירת משתמש חדש

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function createUser(env, { username, password, admin_password }) {
  if (admin_password !== ADMIN_PASSWORD) {
    throw new Error("סיסמת מנהל שגויה");
  }
  if (!username || !password) {
    throw new Error("שם משתמש וסיסמה הם שדות חובה");
  }
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE username = ?`).bind(username).first();
  if (existing) throw new Error("שם המשתמש הזה כבר קיים");

  // יוצר תיקייה בדרייב על שם המשתמש, ובתוכה "קבלות שלא אומתו"
  const userFolderId = await ensureFolder(env, username, env.ROOT_FOLDER_ID);
  await ensureFolder(env, "קבלות שלא אומתו", userFolderId);

  const passwordHash = await hashPassword(password);
  const result = await env.DB.prepare(
    `INSERT INTO users (username, password_hash, drive_folder_id) VALUES (?, ?, ?)`
  ).bind(username, passwordHash, userFolderId).run();

  return { id: result.meta.last_row_id, username };
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare(`SELECT id, username FROM users ORDER BY username`).all();
  return results;
}

export async function loginUser(env, { username, password }) {
  const user = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first();
  if (!user) throw new Error("משתמש לא נמצא");
  const hash = await hashPassword(password);
  if (hash !== user.password_hash) throw new Error("סיסמה שגויה");
  return { id: user.id, username: user.username };
}
