// sync.js
import { ensureFolder, listFiles, downloadFile } from "./drive.js";
import { runOCR } from "./ocr.js";

// סורק את תיקיית "קבלות שלא אומתו" בדרייב, ומכניס למסד הנתונים כל קובץ שעדיין לא מוכר לנו
export async function syncUnverifiedFolder(env) {
  const folderId = await ensureFolder(env, "קבלות שלא אומתו", env.ROOT_FOLDER_ID);
  const files = await listFiles(env, folderId);

  let added = 0;
  for (const file of files) {
    const existing = await env.DB.prepare(`SELECT id FROM receipts WHERE drive_file_id = ?`).bind(file.id).first();
    if (existing) continue; // כבר מוכר לנו, מדלגים

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
      `INSERT INTO receipts (drive_file_id, drive_file_link, supplier_id, amount, tax_id, receipt_date, status, source)
       VALUES (?, ?, ?, ?, ?, ?, 'unverified', 'drive_sync')`
    ).bind(file.id, file.webViewLink, supplierId, extracted.amount || null, extracted.tax_id || null, extracted.date || null).run();

    added++;
  }
  return { scanned: files.length, added };
}

// מחפש הוצאות "צפויות" (status='expected') שהסכום שלהן קרוב לסכום הקבלה שהועלתה כרגע
export async function findExpectedMatches(env, amount) {
  if (!amount) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, receipt_date, amount, category, notes FROM receipts
     WHERE status = 'expected' AND ABS(amount - ?) < 1 ORDER BY receipt_date DESC`
  ).bind(amount).all();
  return results;
}
