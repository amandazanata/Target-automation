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

const findAllJsonOfferReferences = (payload, activityId) => {
  const visited = new Set();
  const matches = [];
  const seenIds = new Set();

  const normalizedActivityId = normalizeString(activityId);

  const search = (node) => {
    if (!node || visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) search(item);
      return;
    }

    if (typeof node === 'object') {
      const offerId = node.offerId || node.id;
      const offerType = normalizeString(node.offerType || node.type);
      const normalizedOfferId = normalizeString(offerId);

      const isActivityId = normalizedOfferId && normalizedOfferId === normalizedActivityId;

      if (offerId && !isActivityId) {
        const isValidType = offerType === 'json' || offerType === 'content';
        const isMissingType = !offerType;

        if ((isValidType || isMissingType) && !seenIds.has(normalizedOfferId)) {
          seenIds.add(normalizedOfferId);
          matches.push({ id: offerId, type: 'json' });
        }
      }

      for (const value of Object.values(node)) {
        search(value);
      }
    }
  };

  search(payload);
  return matches;
};

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
  const offerReferences = findAllJsonOfferReferences(activityDetails, activityId);

  if (!offerReferences || offerReferences.length === 0) {
    const payloadSnippet = JSON.stringify(activityDetails)?.slice(0, 500);
    // eslint-disable-next-line no-console
    console.error('No JSON offers found', { activityId, payloadSnippet });
    throw new Error('No JSON offers found in the provided activity');
  }

  const offersDetails = await Promise.all(
    offerReferences.map((ref) => getOfferDetails(ref.id, ref.type)),
  );

  return {
    activityId,
    activityType: normalizeString(activityType),
    offers: offersDetails,
  };
}

async function getTravaTelasOffers() {
  // 1. Busca todas as atividades
  const { activities = [] } = await getActivities();

  // 2. Filtra por Nome: deve conter '[APP] travaTelasHomeProd'
  const matchingActivities = activities.filter((activity) => (
    activity?.name?.includes(TRAVA_TELAS_IDENTIFIER)
  ));

  // 3. Filtra por Status: deve ser 'approved'
  const approvedActivities = matchingActivities.filter((activity) => (
    normalizeString(activity?.state) === 'approved'
  ));

  // 4. Filtra por Lifetime: NÃO deve possuir data de término ('end')
  // Atividades com 'lifetime.end' definido são descartadas
  const activeActivities = approvedActivities.filter(
    (activity) => !activity.lifetime || !activity.lifetime.end,
  );

  // 5. Busca o conteúdo JSON para as atividades restantes
  const results = await Promise.all(
    activeActivities.map(async (activity) => {
      try {
        const offerPayload = await getJsonOfferFromActivity(activity.id, activity.type);
        return {
          activityId: activity.id,
          activityName: activity.name,
          activityType: normalizeString(activity.type),
          status: activity.state,
          lifetime: activity.lifetime, // Útil para depuração
          offers: offerPayload.offers,
        };
      } catch (error) {
        console.error(`Erro ao buscar ofertas para atividade ${activity.id}:`, error.message);
        return null; // Retorna null em caso de falha individual para não quebrar o Promise.all
      }
    }),
  );

  // Remove eventuais nulos gerados por erros
  return results.filter((result) => result !== null);
}

module.exports = {
  fetchAccessToken,
  getActivities,
  getActivityDetails,
  getOfferDetails,
  findJsonOfferReference: findAllJsonOfferReferences,
  findAllJsonOfferReferences,
  getJsonOfferFromActivity,
  getTravaTelasOffers,
};
