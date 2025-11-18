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

router.get('/:type/:activityId', async (req, res) => {
  const { type, activityId } = req.params;

  try {
    const activityDetails = await adobeTargetService.getActivityDetails(activityId, type);
    res.json(activityDetails);
  } catch (error) {
    const status = error.message.includes('Activity type must be')
      || error.message.includes('required') ? 400 : 500;

    res.status(status).json({
      message: 'Unable to fetch Adobe Target activity details',
      details: error.message,
    });
  }
});

module.exports = router;
