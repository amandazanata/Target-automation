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

router.get('/automation/trava-telas/export', async (req, res) => {
  try {
    const offers = await adobeTargetService.getTravaTelasOffers();
    const payload = {
      generatedAt: new Date().toISOString(),
      totalOffers: offers.length,
      offers,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="trava-telas-ofertas.json"');

    return res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to export approved Trava Telas offers',
      details: error.message,
    });
  }
});

router.put('/automation/trava-telas/update-date', async (req, res) => {
  try {
    const { activityId } = req.query;
    const result = await adobeTargetService.updateTravaTelasOffersDate(activityId || null);
    return res.json({
      message: activityId
        ? `Test run for Activity ID: ${activityId}`
        : 'Offers updated successfully',
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to update Trava Telas offers date',
      details: error.message,
    });
  }
});

module.exports = router;
