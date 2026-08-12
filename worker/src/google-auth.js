// google-auth.js
// יוצר access token מול Google APIs באמצעות Service Account (JWT Bearer flow)
// לא צריך שום דפדפן/משתמש מתחבר - זה "רובוט" עם הרשאות קבועות.
//
// ב-Worker צריך שני secrets (יוגדרו בהמשך כשיהיה מפתח):
//   GOOGLE_SA_EMAIL   - כתובת המייל של ה-Service Account (xxx@yyy.iam.gserviceaccount.com)
//   GOOGLE_SA_KEY     - המפתח הפרטי (private_key) מתוך קובץ ה-JSON שמורידים מ-Google Cloud

function base64url(input) {
  let str = typeof input === "string" ? input : String.fromCharCode(...new Uint8Array(input));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// scope לפי מה שצריך: Drive מלא + Docs + Sheets
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/cloud-vision",
].join(" ");

export async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: env.GOOGLE_SA_EMAIL,
    scope: SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = await importPrivateKey(env.GOOGLE_SA_KEY);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Google auth failed: " + JSON.stringify(data));
  }
  return data.access_token;
}
