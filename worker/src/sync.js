// sync.js
import { ensureFolder, listFiles, downloadFile } from "./drive.js";
import { runOCR } from "./ocr.js";

async function syncOneUserFolder(env, user) {
  const folderId = await ensureFolder(env, "קבלות שלא אומתו", user.drive_folder_id);
  const files = await listFiles(env, folderId);

  let added = 0;
  for (const file of files) {
    const existing = await env.DB.prepare(`SELECT id FROM receipts WHERE drive_file_id = ?`).bind(file.id).first();
    if (existing) continue;

    const bytes = await downloadFile(env, file.id);
    const { extracted } = await runOCR(env, bytes);

    let supplierId = null;
    if (extracted.supplier_name) {
      const s = await env.DB.prepare(`SELECT id FROM suppliers WHERE name = ?`).bind(extracted.supplier_name).first();
      if (s) supplierId = s.id;
      else {
        const created = await env.DB.prepare(`INSERT INTO suppliers (name, tax_id) VALUES (?, ?)`)
          .bind(extracted.supplier_name, extracted.tax_id || null).run();
        supplierId = created.meta.last_row_id;
      }
    }

    await env.DB.prepare(
      `INSERT INTO receipts (drive_file_id, drive_file_link, supplier_id, amount, tax_id, receipt_date, status, source, user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'unverified', 'drive_sync', ?)`
    ).bind(file.id, file.webViewLink, supplierId, extracted.amount || null, extracted.tax_id || null, extracted.date || null, user.id).run();

    added++;
  }
  return added;
}

// עובר על כל המשתמשים הרשומים וסורק את תיקיית "לא אומתו" של כל אחד מהם בנפרד
export async function syncUnverifiedFolder(env) {
  const { results: users } = await env.DB.prepare(`SELECT * FROM users`).all();
  let totalScanned = 0;
  let totalAdded = 0;
  for (const user of users) {
    if (!user.drive_folder_id) continue;
    const added = await syncOneUserFolder(env, user);
    totalAdded += added;
  }
  return { users_scanned: users.length, added: totalAdded };
}
