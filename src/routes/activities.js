const express = require('express');
const adobeTargetService = require('../services/adobeTargetService');

const router = express.Router();

const formatActivities = (payload) => {
  const formatItem = (activity = {}) => ({ id: activity.id, type: activity.type });
  const formatList = (items) => items.filter(Boolean).map(formatItem);

  if (Array.isArray(payload)) {
    return formatList(payload);
  }

  if (Array.isArray(payload?.activities)) {
    return formatList(payload.activities);
  }

  return [];
};

router.get('/', async (req, res) => {
  const { activityName, ...query } = req.query || {};

  try {
    const activities = await adobeTargetService.getActivities(query, activityName);
    res.json(formatActivities(activities));
  } catch (error) {
    res.status(500).json({
      message: 'Unable to fetch Adobe Target activities',
      details: error.message,
    });
  }
});

module.exports = router;
