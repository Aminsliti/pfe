import express from 'express';
import { filterGrcRisks, getGrcApiBaseUrl, normalizeGrcRiskPayload } from '../utils/grcRiskAdapter.js';

const router = express.Router();

async function fetchGrcJson(pathname) {
  const endpoint = `${getGrcApiBaseUrl()}${pathname}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`V-GRC responded with HTTP ${response.status}`);
  }

  return response.json();
}

router.get('/grc/risks', async (req, res) => {
  try {
    const payload = await fetchGrcJson('/risk');
    const normalizedRisks = normalizeGrcRiskPayload(payload);
    const filteredRisks = filterGrcRisks(normalizedRisks, req.query.search);

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      source: getGrcApiBaseUrl(),
      data: filteredRisks,
    });
  } catch (error) {
    console.error('V-GRC risk fetch error:', error);
    res.status(502).json({
      success: false,
      error: 'Unable to reach the V-GRC risk repository. Please verify that the V-GRC API is running and GRC_API_BASE_URL is configured.',
    });
  }
});

export default router;
