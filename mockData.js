require('dotenv').config();
const {google} = require('googleapis');

async function insertMock() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const googleClient = await auth.getClient();
  const sheets = google.sheets({version: 'v4', auth: googleClient});
  
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const ts = new Date().toISOString();
  
  const values = [
    // [timestamp, groupId, userId, displayName, matchId, prediction, outcome]
    [ts, 'mock_group', 'u111', 'จารย์โจ', '9003', '2-1', 'W'], // 3 points (exact)
    [ts, 'mock_group', 'u222', 'พี่ป๋อง', '9003', '1-0', 'W'], // 1 point (outcome)
    [ts, 'mock_group', 'u333', 'เจ๊นัท', '9003', '0-2', 'L'], // 0 points
    [ts, 'mock_group', 'u111', 'จารย์โจ', '9001', '1-1', 'D'], // not finished yet
    [ts, 'mock_group', 'u222', 'พี่ป๋อง', '9001', '3-0', 'W'], // not finished yet
  ];
  
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: 'Predictions!A:G', valueInputOption: 'RAW',
    requestBody: { values },
  });
  console.log('Mock data inserted!');
}
insertMock();
