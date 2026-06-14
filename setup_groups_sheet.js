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
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetTitles = res.data.sheets.map(s => s.properties.title);
    
    if (!sheetTitles.includes('Groups')) {
      console.log('Creating Groups sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Groups'
              }
            }
          }]
        }
      });
      console.log('Adding headers...');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Groups!A1:C1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['GroupId', 'GroupName', 'Password']]
        }
      });
      console.log('Groups sheet created successfully.');
    } else {
      console.log('Groups sheet already exists.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
