const axios = require('axios');
const { URLSearchParams } = require('url');
const {
  tenantId,
  clientId,
  clientSecret,
  apiKey,
  apiScope,
} = require('../config/environment');

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const TARGET_API_BASE_URL = 'https://mc.adobe.io';
const TRAVA_TELAS_IDENTIFIER = '[APP] travaTelasHomeProd';

let cachedToken;

const buildAuthHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
  'x-api-key': apiKey,
  Accept: 'application/vnd.adobe.target.v2+json',
});

const isTokenValid = (token) => token && token.expiresAt && token.expiresAt > Date.now();

async function fetchAccessToken() {
  if (isTokenValid(cachedToken)) {
    return cachedToken.value;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: apiScope,
  });

  try {
    const { data } = await axios.post(IMS_TOKEN_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 1 minute early
    };

    return cachedToken.value;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to retrieve Adobe Target access token: ${JSON.stringify(details)}`);
  }
}

const normalizeString = (value = '') => value.toString().toLowerCase();

const findJsonOfferReferences = (payload, activityId) => {
  const visited = new Set();
  const references = new Map();

  const normalizedActivityId = normalizeString(activityId);

  const search = (node) => {
    if (!node || visited.has(node)) {
      return;
    }

    visited.add(node);

    if (Array.isArray(node)) {
      // eslint-disable-next-line no-restricted-syntax
      for (const item of node) {
        search(item);
      }
      return;
    }

    if (typeof node === 'object') {
      const offerId = node.offerId || node.id;
      const normalizedOfferId = normalizeString(offerId);
      const offerType = normalizeString(node.offerType || node.type) || 'json';

      const isActivityId = normalizedOfferId && normalizedOfferId === normalizedActivityId;

      if (offerId && !isActivityId) {
        const existing = references.get(offerId);

        if (!existing || (existing.type !== 'json' && offerType === 'json')) {
          references.set(offerId, { id: offerId, type: offerType });
        }
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const value of Object.values(node)) {
        search(value);
      }
    }
  };

  search(payload);

  return Array.from(references.values());
};

const findJsonOfferReference = (payload, activityId) => (
  findJsonOfferReferences(payload, activityId)[0] || null
);

async function getActivities(params = {}) {
  const accessToken = await fetchAccessToken();

  try {
    const { data } = await axios.get(`${TARGET_API_BASE_URL}/${tenantId}/target/activities`, {
      headers: buildAuthHeaders(accessToken),
      params,
    });

    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch Adobe Target activities: ${JSON.stringify(details)}`);
  }
}

async function getActivityDetails(activityId, activityType) {
  if (!activityId) {
    throw new Error('An activity id is required to fetch its details');
  }

  const normalizedType = normalizeString(activityType);
  if (!['ab', 'xt'].includes(normalizedType)) {
    throw new Error('Activity type must be either "ab" or "xt"');
  }

  const accessToken = await fetchAccessToken();

  try {
    const { data } = await axios.get(
      `${TARGET_API_BASE_URL}/${tenantId}/target/activities/${normalizedType}/${activityId}`,
      {
        headers: buildAuthHeaders(accessToken),
      },
    );

    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch Adobe Target activity details: ${JSON.stringify(details)}`);
  }
}

async function getOfferDetails(offerId, offerType) {
  const accessToken = await fetchAccessToken();

  try {
    const { data } = await axios.get(
      `${TARGET_API_BASE_URL}/${tenantId}/target/offers/${offerType}/${offerId}`,
      {
        headers: buildAuthHeaders(accessToken),
      },
    );

    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch Adobe Target offer details: ${JSON.stringify(details)}`);
  }
}

async function getJsonOfferFromActivity(activityId, activityType) {
  const activityDetails = await getActivityDetails(activityId, activityType);
  const [offerReference] = findJsonOfferReferences(activityDetails, activityId);

  if (!offerReference) {
    const payloadSnippet = JSON.stringify(activityDetails)?.slice(0, 500);
    // eslint-disable-next-line no-console
    console.error('No JSON offer reference found in the provided activity', {
      activityId,
      activityType,
      payloadSnippet,
    });

    throw new Error('No JSON offer reference found in the provided activity');
  }

  const offerDetails = await getOfferDetails(offerReference.id, offerReference.type);

  return {
    activityId,
    activityType: normalizeString(activityType),
    offerId: offerReference.id,
    offerType: offerReference.type,
    offer: offerDetails,
  };
}

async function getJsonOffersFromActivity(activityId, activityType) {
  const activityDetails = await getActivityDetails(activityId, activityType);
  const hasLifetimeEnd = Boolean(
    activityDetails?.lifetime?.end || activityDetails?.lifetime?.endDate,
  );

  if (hasLifetimeEnd) {
    return { activityDetails, offers: [] };
  }

  const offerReferences = findJsonOfferReferences(activityDetails, activityId);

  if (!offerReferences.length) {
    const payloadSnippet = JSON.stringify(activityDetails)?.slice(0, 500);
    // eslint-disable-next-line no-console
    console.error('No JSON offer reference found in the provided activity', {
      activityId,
      activityType,
      payloadSnippet,
    });

    throw new Error('No JSON offer reference found in the provided activity');
  }

  const offers = await Promise.all(
    offerReferences.map((reference) => getOfferDetails(reference.id, reference.type)),
  );

  return {
    activityDetails,
    offers: offers.map((offerDetails, index) => ({
      activityId,
      activityType: normalizeString(activityType),
      offerId: offerReferences[index].id,
      offerType: offerReferences[index].type,
      offer: offerDetails,
    })),
  };
}

async function getTravaTelasOffers() {
  const { activities = [] } = await getActivities();

  const matchingActivities = activities.filter((activity) => (
    activity?.name?.includes(TRAVA_TELAS_IDENTIFIER)
  ));

  const approvedActivities = matchingActivities.filter((activity) => (
    normalizeString(activity?.state) === 'approved'
  ));

  const offersByActivity = await Promise.all(
    approvedActivities.map(async (activity) => {
      const { activityDetails, offers: activityOffers } = await getJsonOffersFromActivity(
        activity.id,
        activity.type,
      );

      const hasLifetimeEnd = Boolean(
        activityDetails?.lifetime?.end || activityDetails?.lifetime?.endDate,
      );
      if (hasLifetimeEnd) {
        return [];
      }

      return activityOffers.map((offerPayload) => ({
        activityId: activity.id,
        activityName: activity.name,
        activityType: normalizeString(activity.type),
        status: activity.state,
        offer: offerPayload.offer,
      }));
    }),
  );

  return offersByActivity.flat();
}

module.exports = {
  fetchAccessToken,
  getActivities,
  getActivityDetails,
  getOfferDetails,
  findJsonOfferReference,
  findJsonOfferReferences,
  getJsonOfferFromActivity,
  getJsonOffersFromActivity,
  getTravaTelasOffers,
};
