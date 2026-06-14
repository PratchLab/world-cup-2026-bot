const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';

const api = axios.create({
  baseURL: `https://${API_HOST}`,
  headers: {
    'x-apisports-key': API_KEY
  }
});

/**
 * Fetch lineups for a specific fixture
 * @param {number} fixtureId 
 */
async function getLineups(fixtureId) {
  try {
    const res = await api.get('/fixtures/lineups', { params: { fixture: fixtureId } });
    return res.data.response;
  } catch (err) {
    console.error(`Error fetching lineups for fixture ${fixtureId}:`, err.message);
    return [];
  }
}

/**
 * Fetch events (goals, cards, substitutions) for a fixture
 * @param {number} fixtureId 
 */
async function getEvents(fixtureId) {
  try {
    const res = await api.get('/fixtures/events', { params: { fixture: fixtureId } });
    return res.data.response;
  } catch (err) {
    console.error(`Error fetching events for fixture ${fixtureId}:`, err.message);
    return [];
  }
}

/**
 * Fetch statistics (possession, shots) for a fixture
 * @param {number} fixtureId 
 */
async function getStatistics(fixtureId) {
  try {
    const res = await api.get('/fixtures/statistics', { params: { fixture: fixtureId } });
    return res.data.response;
  } catch (err) {
    console.error(`Error fetching stats for fixture ${fixtureId}:`, err.message);
    return [];
  }
}

/**
 * Fetch fixture details (status, score)
 * @param {number} fixtureId 
 */
async function getFixture(fixtureId) {
  try {
    const res = await api.get('/fixtures', { params: { id: fixtureId } });
    return res.data.response[0];
  } catch (err) {
    console.error(`Error fetching fixture ${fixtureId}:`, err.message);
    return null;
  }
}

async function getPredictions(fixtureId) {
  try {
    const res = await api.get('/predictions', { params: { fixture: fixtureId } });
    return res.data.response[0];
  } catch (err) {
    console.error(`Error fetching predictions for fixture ${fixtureId}:`, err.message);
    return null;
  }
}

/**
 * Fetch real betting odds for a fixture (e.g. from Bet365)
 * @param {number} fixtureId 
 */
async function getRealOdds(fixtureId) {
  try {
    // Try bookmaker 8 (Bet365) first
    let res = await api.get('/odds', { params: { fixture: fixtureId, bookmaker: 8 } });
    if (!res.data.response || res.data.response.length === 0) {
        // Fallback to any bookmaker
        res = await api.get('/odds', { params: { fixture: fixtureId } });
    }
    
    if (res.data.response && res.data.response.length > 0) {
        const bookmakers = res.data.response[0].bookmakers;
        if (bookmakers && bookmakers.length > 0) {
            const bets = bookmakers[0].bets;
            const matchWinner = bets.find(b => b.name === 'Match Winner' || b.id === 1);
            if (matchWinner) return matchWinner.values;
        }
    }
    return null;
  } catch (err) {
    console.error(`Error fetching real odds for fixture ${fixtureId}:`, err.message);
    return null;
  }
}

// Global cache for API fixtures
let apiFixturesCache = [];

async function fetchAllApiFixtures() {
  try {
    const res = await api.get('/fixtures', { params: { league: 1, season: 2026 } });
    apiFixturesCache = res.data.response || [];
    console.log(`[API] Fetched ${apiFixturesCache.length} fixtures from API-Football.`);
  } catch (err) {
    console.error("[API] Error fetching API fixtures:", err.message);
  }
}

function getApiFixtureForMatch(sheetMatch) {
  return apiFixturesCache.find(apiMatch => {
    const apiDate = new Date(apiMatch.fixture.date);
    const sheetDate = new Date(sheetMatch.startTime);
    const timeDiff = Math.abs(apiDate - sheetDate);
    if (timeDiff > 12 * 60 * 60 * 1000) return false;
    
    const apiHome = apiMatch.teams.home.name.toLowerCase();
    const apiAway = apiMatch.teams.away.name.toLowerCase();
    const sheetHome = sheetMatch.homeTeam.toLowerCase();
    const sheetAway = sheetMatch.awayTeam.toLowerCase();
    
    if ((apiHome.includes(sheetHome) || sheetHome.includes(apiHome) || (sheetHome === 'usa' && apiHome.includes('united states'))) &&
        (apiAway.includes(sheetAway) || sheetAway.includes(apiAway) || (sheetAway === 'usa' && apiAway.includes('united states')))) {
      return true;
    }
    return false;
  });
}

async function getStandings() {
  const cacheKey = `standings`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < 60 * 60 * 1000) {
    return cache[cacheKey].data;
  }
  try {
    const res = await axios.get(`${BASE_URL}/standings`, {
      headers: {
        'x-rapidapi-host': 'v3.football.api-sports.io',
        'x-rapidapi-key': process.env.API_SPORTS_KEY
      },
      params: { league: 1, season: 2026 }
    });
    const standings = res.data.response[0]?.league?.standings || [];
    cache[cacheKey] = { data: standings, timestamp: Date.now() };
    return standings;
  } catch (err) {
    console.error('Error fetching standings:', err.message);
    return [];
  }
}

module.exports = {
  getLineups,
  getEvents,
  getStatistics,
  getFixture,
  getPredictions,
  getRealOdds,
  fetchAllApiFixtures,
  getApiFixtureForMatch,
  getStandings
};
