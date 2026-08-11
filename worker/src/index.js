// SmartExpense Worker - מערכת ניהול קבלות למוסד
// שלב 1: שלד בסיסי - דשבורד + הוצאות + קבלות (בלי OCR/Drive/Gmail עדיין - זה יבוא בשלב הבא)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function monthKeyOf(dateStr) {
  // dateStr בפורמט YYYY-MM-DD -> מחזיר YYYY-MM
  return dateStr.slice(0, 7);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ---- דשבורד: סך הוצאות החודש, עם קבלה, בלי קבלה ----
      if (path === "/api/dashboard" && method === "GET") {
        const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);

        const totalRow = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
           FROM expenses WHERE substr(expense_date,1,7) = ?`
        ).bind(month).first();

        const withReceiptRow = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
           FROM expenses WHERE substr(expense_date,1,7) = ? AND status = 'completed'`
        ).bind(month).first();

        const withoutReceiptRow = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
           FROM expenses WHERE substr(expense_date,1,7) = ? AND status != 'completed'`
        ).bind(month).first();

        return json({
          month,
          total: totalRow,
          with_receipt: withReceiptRow,
          without_receipt: withoutReceiptRow,
        });
      }

      // ---- רשימת הוצאות (עם סינון חודש אופציונלי) ----
      if (path === "/api/expenses" && method === "GET") {
        const month = url.searchParams.get("month");
        const q = month
          ? env.DB.prepare(
              `SELECT e.*, s.name AS supplier_name FROM expenses e
               LEFT JOIN suppliers s ON s.id = e.supplier_id
               WHERE substr(e.expense_date,1,7) = ? ORDER BY e.expense_date DESC`
            ).bind(month)
          : env.DB.prepare(
              `SELECT e.*, s.name AS supplier_name FROM expenses e
               LEFT JOIN suppliers s ON s.id = e.supplier_id
               ORDER BY e.expense_date DESC LIMIT 200`
            );
        const { results } = await q.all();
        return json(results);
      }

      // ---- יצירת הוצאה חדשה ידנית ----
      if (path === "/api/expenses" && method === "POST") {
        const body = await request.json();
        const { expense_date, supplier_id, amount, description } = body;
        if (!expense_date || !amount) {
          return json({ error: "expense_date ו-amount הם שדות חובה" }, 400);
        }
        const result = await env.DB.prepare(
          `INSERT INTO expenses (expense_date, supplier_id, amount, description, status)
           VALUES (?, ?, ?, ?, 'no_receipt')`
        ).bind(expense_date, supplier_id || null, amount, description || "").run();
        return json({ id: result.meta.last_row_id }, 201);
      }

      // ---- רשימת קבלות שממתינות לאימות (לא אומתו עדיין) ----
      if (path === "/api/receipts" && method === "GET") {
        const status = url.searchParams.get("status") || "unverified";
        const { results } = await env.DB.prepare(
          `SELECT * FROM receipts WHERE status = ? ORDER BY created_at DESC`
        ).bind(status).all();
        return json(results);
      }

      // ---- אישור קבלה: מעביר מ"לא אומת" ל"הונפק" (בהמשך גם יעביר בפועל בדרייב) ----
      if (path.match(/^\/api\/receipts\/\d+\/approve$/) && method === "POST") {
        const id = path.split("/")[3];
        // TODO שלב הבא: להעביר את הקובץ בפועל בין תיקיות ב-Drive דרך Drive API
        await env.DB.prepare(
          `UPDATE receipts SET status = 'verified_unmatched', approved_at = datetime('now') WHERE id = ?`
        ).bind(id).run();
        return json({ ok: true });
      }

      // ---- כפתור "שלח קבלות": סוגר מחזור הגשה לחודש נתון ----
      if (path === "/api/send-receipts" && method === "POST") {
        const body = await request.json();
        const month = body.month || new Date().toISOString().slice(0, 7);

        const totalRow = await env.DB.prepare(
          `SELECT COALESCE(SUM(amount),0) AS total FROM expenses
           WHERE substr(expense_date,1,7) = ? AND submission_status = 'open'`
        ).bind(month).first();

        const cycle = await env.DB.prepare(
          `INSERT INTO submission_cycles (month_key, total_amount, status) VALUES (?, ?, 'open')`
        ).bind(month, totalRow.total).run();

        await env.DB.prepare(
          `UPDATE expenses SET submission_status = 'submitted', cycle_id = ?
           WHERE substr(expense_date,1,7) = ? AND submission_status = 'open'`
        ).bind(cycle.meta.last_row_id, month).run();

        // TODO שלב הבא: להעביר בפועל קבצים בדרייב בין תיקיית "לא הונפקו" ל"נשלח"
        return json({ ok: true, cycle_id: cycle.meta.last_row_id });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
