const express = require('express');
const adobeTargetService = require('../services/adobeTargetService');

const router = express.Router();

router.get('/automation/trava-telas', async (req, res) => {
  try {
    const offers = await adobeTargetService.getTravaTelasOffers();
    return res.json({
      totalOffers: offers.length,
      offers,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to fetch approved Trava Telas offers',
      details: error.message,
    });
  }
});

module.exports = router;
