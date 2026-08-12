// SmartExpense Worker - מערכת ניהול קבלות למוסד
import { ensureFolder, uploadFile, moveFile, downloadFile, trashFile } from "./drive.js";
import { runOCR } from "./ocr.js";
import { createPaymentRequestDoc } from "./docs.js";
import { syncUnverifiedFolder } from "./sync.js";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function monthFolderName(monthKey) {
  const [y, m] = monthKey.split("-");
  return `${HEBREW_MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

async function findOrCreateSupplier(env, name, extra = {}) {
  if (!name) return null;
  const existing = await env.DB.prepare(`SELECT * FROM suppliers WHERE name = ?`).bind(name).first();
  if (existing) return existing.id;
  const result = await env.DB
    .prepare(`INSERT INTO suppliers (name, tax_id, phone, bank_account, bank_code, branch_number, email)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(name, extra.tax_id || null, extra.phone || null, extra.bank_account || null,
          extra.bank_code || null, extra.branch_number || null, extra.email || null)
    .run();
  return result.meta.last_row_id;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    try {
      // ---------- דשבורד ----------
      if (path === "/api/dashboard" && method === "GET") {
        const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);

        const monthTotal = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM receipts
           WHERE substr(receipt_date,1,7) = ? AND status != 'unverified'`
        ).bind(month).first();

        const unverified = await env.DB.prepare(
          `SELECT COUNT(*) AS count FROM receipts WHERE status = 'unverified'`
        ).first();

        const unpaidAllTime = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM receipts WHERE status IN ('unpaid','no_receipt')`
        ).first();

        const paidThisMonth = await env.DB.prepare(
          `SELECT COALESCE(SUM(r.amount),0) AS total, COUNT(*) AS count FROM receipts r
           JOIN payment_cycles c ON c.id = r.paid_cycle_id
           WHERE c.month_key = ?`
        ).bind(month).first();

        return json({ month, month_total: monthTotal, unverified_count: unverified.count, unpaid: unpaidAllTime, paid_this_month: paidThisMonth });
      }

      // ---------- רשימת קבלות (סינון לפי status ו/או month) ----------
      if (path === "/api/receipts" && method === "GET") {
        const status = url.searchParams.get("status");
        const month = url.searchParams.get("month");
        let query = `SELECT r.*, s.name AS supplier_name FROM receipts r
                      LEFT JOIN suppliers s ON s.id = r.supplier_id WHERE 1=1`;
        const binds = [];
        if (status) { query += ` AND r.status = ?`; binds.push(status); }
        if (month) { query += ` AND substr(r.receipt_date,1,7) = ?`; binds.push(month); }
        query += ` ORDER BY r.receipt_date DESC`;
        const { results } = await env.DB.prepare(query).bind(...binds).all();
        return json(results);
      }

      // ---------- סריקה חכמה בלבד (OCR) - לא שומר כלום, רק מחזיר מה שזוהה ----------
      if (path === "/api/ocr-preview" && method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!file) return json({ error: "לא נשלח קובץ" }, 400);
        const bytes = await file.arrayBuffer();
        const { extracted } = await runOCR(env, bytes);
        return json({ extracted });
      }

      // ---------- העלאת קבלה חדשה ----------
      if (path === "/api/receipts/upload" && method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        const mode = form.get("mode") || "verify_later"; // verify_now | verify_later
        if (!file) return json({ error: "לא נשלח קובץ" }, 400);

        const bytes = await file.arrayBuffer();
        const { extracted } = await runOCR(env, bytes);

        const date = form.get("date") || extracted.date || todayStr();
        const amount = form.get("amount") ? parseFloat(form.get("amount")) : extracted.amount;
        const supplierName = form.get("supplier_name") || extracted.supplier_name;
        const taxId = form.get("tax_id") || extracted.tax_id;
        const category = form.get("category") || null;
        const notes = form.get("notes") || null;
        const bankDetails = form.get("bank_details") || null;
        const phone = form.get("phone") || null;
        const email = form.get("email") || null;

        const supplierId = await findOrCreateSupplier(env, supplierName, { tax_id: taxId, phone, email, bank_account: bankDetails });

        let targetFolderId;
        let status;
        if (mode === "verify_now" && date) {
          const monthKey = date.slice(0, 7);
          const monthFolder = await ensureFolder(env, monthFolderName(monthKey), env.ROOT_FOLDER_ID);
          targetFolderId = await ensureFolder(env, "קבלות שלא יצאו", monthFolder);
          status = "unpaid";
        } else {
          targetFolderId = await ensureFolder(env, "קבלות שלא אומתו", env.ROOT_FOLDER_ID);
          status = "unverified";
        }

        const uploaded = await uploadFile(env, {
          name: file.name || `receipt-${Date.now()}`,
          mimeType: file.type || "application/octet-stream",
          bytes,
          parentId: targetFolderId,
        });

        const result = await env.DB.prepare(
          `INSERT INTO receipts (drive_file_id, drive_file_link, supplier_id, amount, tax_id, receipt_date, status, source, approved_at, category, notes, bank_details)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'web_upload', ?, ?, ?, ?)`
        ).bind(
          uploaded.id, uploaded.webViewLink, supplierId, amount || null, taxId || null,
          date || null, status, status === "unpaid" ? new Date().toISOString() : null,
          category, notes, bankDetails
        ).run();

        return json({ id: result.meta.last_row_id, status, extracted }, 201);
      }

      // ---------- הוצאה ללא קבלה (הקבלה עוד לא התקבלה) ----------
      if (path === "/api/receipts/manual" && method === "POST") {
        const body = await request.json();
        const { date, amount, supplier_name, tax_id, category, notes, bank_details, phone, email } = body;
        if (!amount || !supplier_name) {
          return json({ error: "סכום ושם ספק הם שדות חובה" }, 400);
        }
        const supplierId = await findOrCreateSupplier(env, supplier_name, { tax_id, phone, email, bank_account: bank_details });
        const result = await env.DB.prepare(
          `INSERT INTO receipts (supplier_id, amount, tax_id, receipt_date, status, source, category, notes, bank_details)
           VALUES (?, ?, ?, ?, 'no_receipt', 'manual', ?, ?, ?)`
        ).bind(supplierId, amount, tax_id || null, date || todayStr(), category || null, notes || null, bank_details || null).run();
        return json({ id: result.meta.last_row_id, status: "no_receipt" }, 201);
      }

      // ---------- צירוף קובץ קבלה מאוחר יותר להוצאה ללא קבלה ----------
      if (path.match(/^\/api\/receipts\/\d+\/attach$/) && method === "POST") {
        const id = path.split("/")[3];
        const receipt = await env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
        if (!receipt) return json({ error: "קבלה לא נמצאה" }, 404);

        const form = await request.formData();
        const file = form.get("file");
        if (!file) return json({ error: "לא נשלח קובץ" }, 400);
        const bytes = await file.arrayBuffer();

        const ready = Boolean(receipt.receipt_date && receipt.amount && receipt.supplier_id && receipt.tax_id);
        let targetFolderId;
        if (ready) {
          const monthKey = receipt.receipt_date.slice(0, 7);
          const monthFolder = await ensureFolder(env, monthFolderName(monthKey), env.ROOT_FOLDER_ID);
          targetFolderId = await ensureFolder(env, "קבלות שלא יצאו", monthFolder);
        } else {
          targetFolderId = await ensureFolder(env, "קבלות שלא אומתו", env.ROOT_FOLDER_ID);
        }

        const uploaded = await uploadFile(env, {
          name: file.name || `receipt-${Date.now()}`,
          mimeType: file.type || "application/octet-stream",
          bytes,
          parentId: targetFolderId,
        });

        const newStatus = ready ? "unpaid" : "unverified";
        await env.DB.prepare(
          `UPDATE receipts SET drive_file_id = ?, drive_file_link = ?, status = ?,
             approved_at = CASE WHEN ? = 'unpaid' THEN datetime('now') ELSE approved_at END
           WHERE id = ?`
        ).bind(uploaded.id, uploaded.webViewLink, newStatus, newStatus, id).run();

        return json({ ok: true, status: newStatus });
      }

      // ---------- עריכת קבלה/הוצאה כלשהי (טבלה מלאה) ----------
      if (path.match(/^\/api\/receipts\/\d+$/) && method === "PATCH") {
        const id = path.split("/")[3];
        const receipt = await env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
        if (!receipt) return json({ error: "קבלה לא נמצאה" }, 404);

        const body = await request.json();
        const { date, amount, supplier_name, tax_id, status } = body;

        let supplierId = receipt.supplier_id;
        if (supplier_name) supplierId = await findOrCreateSupplier(env, supplier_name, { tax_id });

        await env.DB.prepare(
          `UPDATE receipts SET
             receipt_date = COALESCE(?, receipt_date),
             amount = COALESCE(?, amount),
             supplier_id = ?,
             tax_id = COALESCE(?, tax_id),
             status = COALESCE(?, status)
           WHERE id = ?`
        ).bind(date || null, amount == null || amount === "" ? null : amount, supplierId, tax_id || null, status || null, id).run();

        return json({ ok: true });
      }

      // ---------- מחיקת קבלה/הוצאה ----------
      if (path.match(/^\/api\/receipts\/\d+$/) && method === "DELETE") {
        const id = path.split("/")[3];
        const receipt = await env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
        if (!receipt) return json({ error: "קבלה לא נמצאה" }, 404);
        if (receipt.drive_file_id) {
          try {
            await trashFile(env, receipt.drive_file_id);
          } catch (e) {
            // ממשיכים למחוק את הרשומה גם אם המחיקה בדרייב נכשלה
          }
        }
        await env.DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(id).run();
        return json({ ok: true });
      }

      // ---------- אישור קבלה שהייתה "לא אומתה" ----------
      if (path.match(/^\/api\/receipts\/\d+\/approve$/) && method === "POST") {
        const id = path.split("/")[3];
        const body = await request.json();
        const { date, amount, supplier_name, tax_id } = body;
        if (!date || !amount || !supplier_name || !tax_id) {
          return json({ error: "תאריך, סכום, שם ספק וח.פ הם שדות חובה" }, 400);
        }

        const receipt = await env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
        if (!receipt) return json({ error: "קבלה לא נמצאה" }, 404);

        const supplierId = await findOrCreateSupplier(env, supplier_name, { tax_id });

        const monthKey = date.slice(0, 7);
        const monthFolder = await ensureFolder(env, monthFolderName(monthKey), env.ROOT_FOLDER_ID);
        const targetFolderId = await ensureFolder(env, "קבלות שלא יצאו", monthFolder);
        if (receipt.drive_file_id) {
          await moveFile(env, receipt.drive_file_id, targetFolderId);
        }

        await env.DB.prepare(
          `UPDATE receipts SET status = 'unpaid', supplier_id = ?, amount = ?, tax_id = ?, receipt_date = ?, approved_at = datetime('now')
           WHERE id = ?`
        ).bind(supplierId, amount, tax_id, date, id).run();

        return json({ ok: true });
      }

      // ---------- סנכרון: קבצים שהוכנסו ידנית לתיקיית "לא אומתו" בדרייב ----------
      if (path === "/api/sync-drive" && method === "POST") {
        const result = await syncUnverifiedFolder(env);
        return json(result);
      }

      // ---------- ספקים ----------
      if (path === "/api/suppliers" && method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT s.*,
             COALESCE((SELECT SUM(amount) FROM receipts WHERE supplier_id = s.id AND status != 'unverified'), 0) AS total_spent,
             COALESCE((SELECT SUM(amount) FROM receipts WHERE supplier_id = s.id AND status = 'paid'), 0) AS total_paid
           FROM suppliers s ORDER BY s.name`
        ).all();
        return json(results);
      }

      if (path === "/api/suppliers" && method === "POST") {
        const body = await request.json();
        const { name, tax_id, phone, bank_account, bank_code, branch_number, email } = body;
        if (!name) return json({ error: "שם ספק הוא שדה חובה" }, 400);
        const existing = await env.DB.prepare(`SELECT id FROM suppliers WHERE name = ?`).bind(name).first();
        if (existing) {
          await env.DB.prepare(
            `UPDATE suppliers SET tax_id=?, phone=?, bank_account=?, bank_code=?, branch_number=?, email=? WHERE id=?`
          ).bind(tax_id || null, phone || null, bank_account || null, bank_code || null, branch_number || null, email || null, existing.id).run();
          return json({ id: existing.id, updated: true });
        }
        const result = await env.DB.prepare(
          `INSERT INTO suppliers (name, tax_id, phone, bank_account, bank_code, branch_number, email) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(name, tax_id || null, phone || null, bank_account || null, bank_code || null, branch_number || null, email || null).run();
        return json({ id: result.meta.last_row_id }, 201);
      }

      // ---------- ייצוא: מעביר את כל "לא יצאו" ל"יצאו" של החודש הנוכחי ----------
      if (path === "/api/export" && method === "POST") {
        const format = url.searchParams.get("format") || "xlsx";
        const { results: unpaid } = await env.DB.prepare(
          `SELECT r.*, s.name AS supplier_name FROM receipts r
           LEFT JOIN suppliers s ON s.id = r.supplier_id WHERE r.status IN ('unpaid','no_receipt')`
        ).all();

        if (unpaid.length === 0) return json({ error: "אין הוצאות שלא יצאו להחזר" }, 400);

        const monthKey = new Date().toISOString().slice(0, 7);
        const monthFolder = await ensureFolder(env, monthFolderName(monthKey), env.ROOT_FOLDER_ID);
        const paidFolderId = await ensureFolder(env, "קבלות שיצאו להחזר", monthFolder);

        const total = unpaid.reduce((sum, r) => sum + (r.amount || 0), 0);
        let docLink = null;

        if (format === "doc") {
          const monthLabel = `${HEBREW_MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`;
          const doc = await createPaymentRequestDoc(env, unpaid, "ישיבת ארחות יושר", monthLabel);
          docLink = doc.link;
        }

        const cycle = await env.DB.prepare(
          `INSERT INTO payment_cycles (month_key, total_amount, doc_link) VALUES (?, ?, ?)`
        ).bind(monthKey, total, docLink).run();
        const cycleId = cycle.meta.last_row_id;

        for (const r of unpaid) {
          if (r.drive_file_id) await moveFile(env, r.drive_file_id, paidFolderId);
          await env.DB.prepare(
            `UPDATE receipts SET status = 'paid', paid_cycle_id = ? WHERE id = ?`
          ).bind(cycleId, r.id).run();
        }

        if (format === "xlsx") {
          const csvRows = ["תאריך,ספק,ח.פ,סכום", ...unpaid.map(r =>
            `${r.receipt_date || ""},${(r.supplier_name || "").replace(/,/g, " ")},${r.tax_id || ""},${r.amount || 0}`
          )];
          const csv = "\uFEFF" + csvRows.join("\n"); // BOM כדי שעברית תיפתח נכון באקסל
          return new Response(csv, {
            status: 200,
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="hozaot-${monthKey}.csv"`,
              ...corsHeaders(),
            },
          });
        }

        return json({ ok: true, cycle_id: cycleId, total, count: unpaid.length, doc_link: docLink });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
