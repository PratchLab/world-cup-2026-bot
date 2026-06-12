require('dotenv').config();
const { google } = require('googleapis');

async function check() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const googleClient = await auth.getClient();
  const sheets = google.sheets({version: 'v4', auth: googleClient});
  
  const mRes = await sheets.spreadsheets.values.get({ 
    spreadsheetId: process.env.GOOGLE_SHEET_ID, 
    range: 'Matches!A2:H3' 
  });
  console.log("Matches:", mRes.data.values);
  
  const pRes = await sheets.spreadsheets.values.get({ 
    spreadsheetId: process.env.GOOGLE_SHEET_ID, 
    range: 'Predictions!A2:G' 
  });
  console.log("Predictions:", pRes.data.values);
}

check();
