require('dotenv').config();
const { google } = require('googleapis');

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const googleClient = await auth.getClient();
  return google.sheets({version: 'v4', auth: googleClient});
}

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  
  try {
    console.log('Adding headers to Groups sheet...');
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Groups!A1:C1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['GroupId', 'GroupName', 'Password']]
      }
    });
    console.log('Headers added successfully.');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
