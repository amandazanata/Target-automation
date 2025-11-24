const express = require('express');
const adobeTargetService = require('../services/adobeTargetService');

const router = express.Router();

router.get('/offers/json', async (req, res) => {
  const { activityId, activityType } = req.query;

  if (!activityId || !activityType) {
    return res.status(400).json({
      message: 'Both activityId and activityType query params are required',
    });
  }

  try {
    const offerPayload = await adobeTargetService.getJsonOfferFromActivity(
      activityId,
      activityType,
    );
    return res.json(offerPayload);
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to fetch JSON offer from activity',
      details: error.message,
    });
  }
});

module.exports = router;
