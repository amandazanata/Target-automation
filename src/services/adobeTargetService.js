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

const getSchedulingAccordingToInterface = (activity) => {
  /* status da API: approved|deactivated|paused|saved|deleted
  status da interface: live|scheduled|ended|archived|inactive|draft|syncing

  mapeados:
    approved = live|scheduled|ended
    deactivated = archived
    saved = inactive
  */

  let scheduling = '';
  const start = activity?.startsAt || activity.lifetime?.start;
  const end = activity?.endsAt || activity.lifetime?.end;

  const startsDate = start ? new Date(start) : null;
  const endsDate = end ? new Date(end) : null;
  const today = new Date();

  const isStartDateMissing = !startsDate;
  const isEndDateMissing = !endsDate;
  const isTodayAfterStart = startsDate && today >= startsDate;
  const isTodayBeforeEnd = endsDate && today <= endsDate;
  const isTodayAfterEnd = endsDate && today > endsDate;

  const isLive = isStartDateMissing
    || (isTodayAfterStart && (isEndDateMissing || isTodayBeforeEnd));

  if (isLive) {
    scheduling = 'live';
  } else if (isTodayAfterEnd) {
    scheduling = 'expired';
  } else {
    scheduling = 'scheduled';
  }

  return [scheduling, start, end];
};

const getAudienceDetails = (audienceIds = [], audienceList = []) => {
  if (audienceIds.length === 0) {
    return { name: 'ALL VISITORS', id: null };
  }

  const audienceOverview = audienceList.find((audience) => audience.id === audienceIds[0]);
  const name = audienceOverview
    ? audienceOverview.name || audienceOverview.type
    : 'AUDIENCE NOT FOUND';

  return { name, id: audienceIds[0] };
};

const buildCompleteActivity = (activityDetails, activityOverview, audienceList = []) => {
  /* Os dados da API de UMA atividade são organizados de maneira a representar informações
  sobre experiences, locations e options associadas a cada experiência.

  O relacionamento entre esses dados ocorre da seguinte forma:
  - experiences: Cada objeto experience contém um identificador único e uma lista de options
    associadas. A chave que faz essa ligação é o optionLocalId.
  - locations: Cada objeto location contém um identificador único que é utilizado para associar
    a location com as experiências. A chave que faz essa ligação é o locationLocalId.
  - options: Cada objeto option está associada a uma experiência através do optionLocalId.
  */

  const {
    experiences,
    locations,
    options,
    priority,
  } = activityDetails;

  const experiencesWithLocations = experiences.map((experience, index) => {
    const [mbox] = experience.optionLocations.map((ol) => (
      locations.mboxes.find(
        (locationMbox) => locationMbox.locationLocalId === ol.locationLocalId,
      )
    ));

    return {
      ...experience,
      position: index + 1,
      mbox,
    };
  });

  const enrichedOptions = options.map((option) => {
    const correspondingExperience = experiencesWithLocations
      .find((experience) => experience.optionLocations
        .some((ol) => ol.optionLocalId === option.optionLocalId));

    if (correspondingExperience) {
      const audienceIds = activityOverview.type === 'ab'
        ? correspondingExperience.mbox.audienceIds
        : correspondingExperience.audienceIds;

      return {
        ...option,
        audienceDetails: getAudienceDetails(audienceIds, audienceList),
        ordination: {
          priority,
          position: correspondingExperience.position,
        },
        experience: {
          experienceLocalId: correspondingExperience.experienceLocalId,
          name: correspondingExperience.name,
          audienceIds: correspondingExperience.audienceIds,
          mbox: correspondingExperience.mbox,
        },
        visitorPercentage: correspondingExperience?.visitorPercentage
          ? correspondingExperience.visitorPercentage
          : 'N/A',
      };
    }
    return option;
  });

  const normalizedDetails = {
    ...activityDetails,
    startsAt:
      activityDetails.startsAt || activityOverview.startsAt || 'when activated',
    endsAt: activityDetails.endsAt || activityOverview.endsAt || 'when deactivated',
  };

  const {
    locations: _locations,
    experiences: _experiences,
    ...activityWithoutLinks
  } = normalizedDetails;
  const [scheduling, startsAt, endsAt] = getSchedulingAccordingToInterface(activityWithoutLinks);

  return {
    ...activityWithoutLinks,
    type: activityOverview.type,
    scheduling,
    startsAt,
    endsAt,
    options: enrichedOptions.sort((a, b) => a.ordination.position - b.ordination.position),
  };
};

const findJsonOfferReferences = (payload, activityId) => {
  const visited = new WeakSet();
  const matches = [];
  const seenIds = new Set();

  const normalizedActivityId = normalizeString(activityId);

  const search = (node) => {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach(search);
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

      Object.values(node).forEach(search);
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

async function getAudiences(params = {}) {
  const accessToken = await fetchAccessToken();

  try {
    const { data } = await axios.get(`${TARGET_API_BASE_URL}/${tenantId}/target/audiences`, {
      headers: buildAuthHeaders(accessToken),
      params,
    });

    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch Adobe Target audiences: ${JSON.stringify(details)}`);
  }
}

async function getOffers(params = {}) {
  const accessToken = await fetchAccessToken();

  try {
    const { data } = await axios.get(`${TARGET_API_BASE_URL}/${tenantId}/target/offers`, {
      headers: buildAuthHeaders(accessToken),
      params,
    });

    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch Adobe Target offers: ${JSON.stringify(details)}`);
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

const buildOffersPromises = (activity, listOffers = []) => activity.options.map(async (option) => {
  const offer = listOffers.find((item) => item.id === option.offerId) || {};
  const offerType = offer.type || option.type || 'json';
  const offerDetails = await getOfferDetails(option.offerId, offerType);

  const {
    scheduling,
    startsAt,
    endsAt,
    type: activityType,
  } = activity;
  const optionMeta = {
    scheduling: { status: scheduling, startsAt, endsAt },
    type: { activity: activityType, offer: offerType },
  };

  const { id, content } = offerDetails;

  return { ...option, ...optionMeta, offerDetails: { id, content } };
});

async function getActivityWithOffers(activityOverview, audienceList = [], offerList = []) {
  const activityDetails = await getActivityDetails(activityOverview.id, activityOverview.type);
  const completeActivity = buildCompleteActivity(activityDetails, activityOverview, audienceList);
  const offersDetails = await Promise.all(buildOffersPromises(completeActivity, offerList));

  return { ...completeActivity, options: offersDetails };
}

async function getTravaTelasOffers() {
  const [activitiesResponse, audiencesResponse, offersResponse] = await Promise.all([
    getActivities(),
    getAudiences(),
    getOffers(),
  ]);

  const activities = activitiesResponse.activities || [];
  const audienceList = audiencesResponse.audiences || [];
  const offerList = offersResponse.offers || [];

  const matchingActivities = activities.filter((activity) => (
    activity?.name?.includes(TRAVA_TELAS_IDENTIFIER)
  ));

  const approvedActivities = matchingActivities.filter((activity) => (
    normalizeString(activity?.state) === 'approved'
  ));

  const activeActivities = approvedActivities.filter(
    (activity) => !activity.lifetime || !activity.lifetime.end,
  );

  const results = await Promise.all(
    activeActivities.map(async (activity) => {
      try {
        const activityWithOffers = await getActivityWithOffers(activity, audienceList, offerList);
        return activityWithOffers;
      } catch (error) {
        console.error(`Erro ao buscar ofertas para atividade ${activity.id}:`, error.message);
        return null;
      }
    }),
  );

  return results.filter((result) => result !== null);
}

module.exports = {
  fetchAccessToken,
  getActivities,
  getActivityDetails,
  getOfferDetails,
  getAudiences,
  getOffers,
  findJsonOfferReference: findJsonOfferReferences,
  findJsonOfferReferences,
  getTravaTelasOffers,
};
