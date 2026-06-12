require('dotenv').config();
const { google } = require('googleapis');

async function check() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const googleClient = await auth.getClient();
  const sheets = google.sheets({version: 'v4', auth: googleClient});
  
  const res = await sheets.spreadsheets.values.get({ 
    spreadsheetId: process.env.GOOGLE_SHEET_ID, 
    range: 'Matches!A2:I3' 
  });
  
  console.log(res.data.values);
}

check();
