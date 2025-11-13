const express = require('express');
const adobeTargetService = require('../services/adobeTargetService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const activities = await adobeTargetService.getActivities(req.query);
    res.json(activities);
  } catch (error) {
    res.status(500).json({
      message: 'Unable to fetch Adobe Target activities',
      details: error.message,
    });
  }
});

module.exports = router;
