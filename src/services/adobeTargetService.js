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

const findJsonOfferReference = (payload, activityId) => {
  const visited = new Set();
  let potentialMatch = null;

  const normalizedActivityId = normalizeString(activityId);

  const search = (node) => {
    if (!node || visited.has(node)) {
      return null;
    }

    visited.add(node);

    if (Array.isArray(node)) {
      // eslint-disable-next-line no-restricted-syntax
      for (const item of node) {
        const result = search(item);
        if (result) {
          return result;
        }
      }
      return null;
    }

    if (typeof node === 'object') {
      const offerId = node.offerId || node.id;
      const offerType = normalizeString(node.offerType || node.type);
      const normalizedOfferId = normalizeString(offerId);

      const isActivityId = normalizedOfferId && normalizedOfferId === normalizedActivityId;

      if (offerId && !isActivityId) {
        if (offerType === 'json') {
          return { id: offerId, type: 'json' };
        }

        if (!potentialMatch) {
          potentialMatch = { id: offerId, type: offerType || 'json' };
        }
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const value of Object.values(node)) {
        const result = search(value);
        if (result) {
          return result;
        }
      }
    }

    return null;
  };

  const explicitMatch = search(payload);

  return explicitMatch || potentialMatch;
};

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
  const offerReference = findJsonOfferReference(activityDetails, activityId);

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

module.exports = {
  fetchAccessToken,
  getActivityDetails,
  getOfferDetails,
  findJsonOfferReference,
  getJsonOfferFromActivity,
};
