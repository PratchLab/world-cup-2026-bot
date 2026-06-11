const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_HOST = process.env.API_FOOTBALL_HOST;

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

module.exports = {
  getLineups,
  getEvents,
  getStatistics,
  getFixture
};
