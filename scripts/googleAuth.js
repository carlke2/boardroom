require("dotenv").config();

const readline = require("readline");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

console.log("REDIRECT FROM ENV:", REDIRECT_URI);
console.log("CLIENT_ID (first 20):", (CLIENT_ID || "").slice(0, 20));

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error("\n❌ Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in .env\n");
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

async function main() {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\n================= AUTH URL =================");
  console.log(authUrl);
  console.log("===========================================\n");

  // Help you spot the exact redirect_uri Google is using
  try {
    const u = new URL(authUrl);
    console.log("redirect_uri param:", u.searchParams.get("redirect_uri"));
    console.log("");
  } catch (_) {}

  console.log("1) Open the AUTH URL above in your browser.");
  console.log("2) Approve.");
  console.log("3) You may see 'site can’t be reached' — ignore it.");
  console.log("4) Copy the CODE from the URL (after code=...) and paste it below.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Paste code: ", async (code) => {
    try {
      const { tokens } = await oAuth2Client.getToken(code.trim());
      console.log("\n TOKENS RECEIVED:\n", tokens);

      if (!tokens.refresh_token) {
        console.log(
          "\n No refresh_token returned.\n" +
            "Fix: Re-run the script and make sure prompt:'consent' is present (it is),\n" +
            "and you are not reusing a previously approved consent. Try in an Incognito window.\n"
        );
      } else {
        console.log("\n>>> Copy refresh_token into .env as GOOGLE_REFRESH_TOKEN\n");
      }
    } catch (e) {
      const msg =
        e?.response?.data?.error_description ||
        e?.response?.data?.error ||
        e?.message ||
        String(e);

      console.error("\nToken exchange failed:", msg);

      console.error(
  "Wrong client secret / wrong client id (copy again from Google Cloud).\n" +
  "\nMost common fixes:\n" +
  "1) redirect_uri_mismatch → add EXACT redirect_uri shown above into Google Cloud OAuth client.\n" +
  "2) invalid_client → wrong client id/secret, or they are not set in .env. Copy again from Google Cloud.\n"
);

    } finally {
      rl.close();
    }
  });
}

main().catch((e) => {
  console.error(" Script failed:", e?.message || e);
});
