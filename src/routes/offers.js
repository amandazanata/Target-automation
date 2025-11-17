const express = require('express');
const adobeTargetService = require('../services/adobeTargetService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { status, approvalStatus, ...query } = req.query;
    const normalizedStatus = (status || approvalStatus || '').toLowerCase();

    if (normalizedStatus === 'approved') {
      const offers = await adobeTargetService.getApprovedOffers({ ...query, approvalStatus });
      return res.json(offers);
    }

    const offers = await adobeTargetService.getOffers({ ...query, approvalStatus, status });
    return res.json(offers);
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to fetch Adobe Target offers',
      details: error.message,
    });
  }
});

router.get('/approved', async (req, res) => {
  try {
    const offers = await adobeTargetService.getApprovedOffers(req.query);
    return res.json(offers);
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to fetch approved Adobe Target offers',
      details: error.message,
    });
  }
});

router.get('/:offerId', async (req, res) => {
  try {
    const offer = await adobeTargetService.getOfferDetails(req.params.offerId, req.query);
    return res.json(offer);
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to fetch Adobe Target offer details',
      details: error.message,
    });
  }
});

module.exports = router;
