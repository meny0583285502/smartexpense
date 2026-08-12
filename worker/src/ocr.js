// ocr.js
import { getGoogleAccessToken } from "./google-auth.js";

function bytesToBase64(bytes) {
  let binary = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

export async function runOCR(env, bytes) {
  const token = await getGoogleAccessToken(env);
  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: bytesToBase64(bytes) },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });
  const data = await res.json();
  const apiError = data?.responses?.[0]?.error;
  if (!res.ok || apiError) {
    throw new Error("Vision API error: " + JSON.stringify(apiError || data));
  }
  const text = data?.responses?.[0]?.fullTextAnnotation?.text || "";
  return { rawText: text, extracted: extractFields(text) };
}

// חילוץ ראשוני מבוסס regex - לדיוק גבוה יותר נצטרך לכייל לפי דוגמאות קבלות אמיתיות
function extractFields(text) {
  const result = { date: null, amount: null, supplier_name: null, tax_id: null };

  // תאריך: DD/MM/YYYY או DD.MM.YYYY או DD-MM-YYYY
  const dateMatch = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dateMatch) {
    let [, d, m, y] = dateMatch;
    if (y.length === 2) y = "20" + y;
    result.date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // ח.פ / עוסק מורשה: 9 ספרות, לרוב אחרי "ח.פ" או "עוסק מורשה" או "ע.מ"
  const taxIdMatch = text.match(/(?:ח\.?פ\.?|עוסק מורשה|ע\.?מ\.?)\D{0,5}(\d{8,9})/);
  if (taxIdMatch) result.tax_id = taxIdMatch[1];

  // סכום: מחפש "סה"כ" / "לתשלום" / "סך הכל" ואז מספר עם עשרוני, או הכי גדול שנמצא
  const totalLineMatch = text.match(/(?:סה"?כ|לתשלום|סך הכל|total)\D{0,10}([\d,]+\.\d{2})/i);
  if (totalLineMatch) {
    result.amount = parseFloat(totalLineMatch[1].replace(/,/g, ""));
  } else {
    const allAmounts = [...text.matchAll(/(\d{1,3}(?:,\d{3})*\.\d{2})/g)].map((m) =>
      parseFloat(m[1].replace(/,/g, ""))
    );
    if (allAmounts.length) result.amount = Math.max(...allAmounts);
  }

  // שם ספק: השורה הראשונה שאינה ריקה (לרוב לוגו/שם העסק בראש הקבלה) - ניחוש ראשוני בלבד
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 1);
  if (firstLine) result.supplier_name = firstLine;

  return result;
}
