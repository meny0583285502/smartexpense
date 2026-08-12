// docs.js
import { getUserAccessToken } from "./user-auth.js";
import { ensureFolder, moveFile } from "./drive.js";

async function docsFetch(env, path, options = {}) {
  const token = await getUserAccessToken(env);
  const res = await fetch(`https://docs.googleapis.com/v1${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Docs API error: " + (await res.text()));
  return res.json();
}

// rows: [{ bank_details, tax_id, supplier_name, amount, category, notes }]
export async function createPaymentRequestDoc(env, rows, requesterName = "") {
  const today = new Date().toLocaleDateString("he-IL");
  const created = await docsFetch(env, "/documents", {
    method: "POST",
    body: JSON.stringify({ title: `בקשת תשלומים - ${today}` }),
  });
  const docId = created.documentId;

  // בונים טבלה: שורת כותרות + שורה לכל הוצאה
  const headers = ["פרטי חשבון בנק", "מספר עוסק", "שם ספק", "סכום", "סעיף תקציבי", "הערות"];
  const tableRows = [headers, ...rows.map(r => [
    r.bank_details || "", r.tax_id || "", r.supplier_name || "",
    `₪${(r.amount || 0).toLocaleString()}`, r.category || "", r.notes || "",
  ])];

  // מוסיפים כותרת + טבלה במסמך (Docs API: קודם טקסט, אז טבלה בסוף המסמך)
  await docsFetch(env, `/documents/${docId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        { insertText: { location: { index: 1 }, text: `טופס בקשת תשלומים\nתאריך: ${today}\nהמוסד המזמין: ${requesterName}\n\n` } },
      ],
    }),
  });

  const doc2 = await docsFetch(env, `/documents/${docId}`);
  const endIndex = doc2.body.content[doc2.body.content.length - 1].endIndex - 1;

  await docsFetch(env, `/documents/${docId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        { insertTable: { rows: tableRows.length, columns: headers.length, location: { index: endIndex } } },
      ],
    }),
  });

  // ממלאים את תאי הטבלה (צריך לקרוא שוב את מבנה המסמך כדי למצוא את האינדקסים המדויקים של כל תא)
  const doc3 = await docsFetch(env, `/documents/${docId}`);
  const table = doc3.body.content.find(c => c.table)?.table;
  const fillRequests = [];
  if (table) {
    table.tableRows.forEach((row, rIdx) => {
      row.tableCells.forEach((cell, cIdx) => {
        const text = tableRows[rIdx][cIdx];
        if (text) {
          const cellIndex = cell.content[0].startIndex;
          fillRequests.push({ insertText: { location: { index: cellIndex }, text } });
        }
      });
    });
    // חייבים להכניס מהסוף להתחלה כדי שהאינדקסים לא יזוזו
    fillRequests.reverse();
    if (fillRequests.length) {
      await docsFetch(env, `/documents/${docId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: fillRequests }),
      });
    }
  }

  // מעבירים את המסמך לתיקיית "בקשות ארחות יושר"
  const targetFolder = await ensureFolder(env, "בקשות ארחות יושר", env.ROOT_FOLDER_ID);
  await moveFile(env, docId, targetFolder);

  return { docId, link: `https://docs.google.com/document/d/${docId}/edit` };
}
