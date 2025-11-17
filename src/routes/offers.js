const express = require('express');
const adobeTargetService = require('../services/adobeTargetService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const {
      status,
      approvalStatus,
      mboxName,
      ...query
    } = req.query;
    const normalizedStatus = (status || approvalStatus || '').toLowerCase();

    if (normalizedStatus === 'approved') {
      const offers = await adobeTargetService.getApprovedOffers(
        { ...query, approvalStatus },
        mboxName,
      );
      return res.json(offers);
    }

    const offers = await adobeTargetService.getOffers(
      { ...query, approvalStatus, status },
      mboxName,
    );
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
  const { offerId } = req.params;

  try {
    const offerList = await adobeTargetService.getOffers({ search: offerId });

    if (!offerList || !offerList.offers || offerList.offers.length === 0) {
      return res.status(404).json({ message: `Offer with ID ${offerId} not found` });
    }

    const offerType = offerList.offers[0].type;
    const offerDetails = await adobeTargetService.getOfferDetails(offerId, offerType);
    offerDetails.type = offerType;

    return res.json(offerDetails);
  } catch (error) {
    return res.status(500).json({
      message: 'Unable to fetch Adobe Target offer details',
      details: error.message,
    });
  }
});

module.exports = router;
