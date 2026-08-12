// ocr.js - עכשיו דרך Cloudflare Workers AI (מודל ראייה) במקום Google Vision
// חינמי, לא דורש חיוב בגוגל - רץ ישירות על התשתית של Cloudflare שבה ה-Worker כבר רץ.

const PROMPT = `זו תמונה של קבלה או חשבונית. תחלץ ממנה את הפרטים הבאים ותחזיר אך ורק אובייקט JSON תקין, בלי שום טקסט נוסף:
{"date": "YYYY-MM-DD או null", "amount": מספר או null (הסכום הסופי לתשלום), "supplier_name": "שם העסק/ספק או null", "tax_id": "מספר עוסק/ח.פ (8-9 ספרות) או null"}`;

export async function runOCR(env, bytes) {
  const imageArray = [...new Uint8Array(bytes)];

  const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
    image: imageArray,
    prompt: PROMPT,
    max_tokens: 512,
  });

  const rawText = result?.description || result?.response || "";
  const extracted = parseJsonFromText(rawText);
  return { rawText, extracted };
}

function parseJsonFromText(text) {
  const empty = { date: null, amount: null, supplier_name: null, tax_id: null };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return empty;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      date: parsed.date || null,
      amount: typeof parsed.amount === "number" ? parsed.amount : parseFloat(parsed.amount) || null,
      supplier_name: parsed.supplier_name || null,
      tax_id: parsed.tax_id ? String(parsed.tax_id) : null,
    };
  } catch (e) {
    return empty;
  }
}
