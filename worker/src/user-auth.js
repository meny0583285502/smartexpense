// user-auth.js
// אימות מול Drive/Docs/Sheets בשם המשתמש האישי (לא Service Account) -
// כי ל-Service Account אין storage quota בדרייב אישי רגיל (בלי Workspace).
// דורש שלושה secrets:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN   (מתקבל פעם אחת מ-OAuth Playground)

export async function getUserAccessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Google user auth failed: " + JSON.stringify(data));
  }
  return data.access_token; // תקף לשעה, נוצר מחדש בכל קריאה - פשוט וזול מספיק לנפח שימוש כזה
}
