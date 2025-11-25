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

// --- HELPER FUNCTIONS

function getSchedulingAccordingToInterface(activity) {
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

  const isLive = isStartDateMissing || (isTodayAfterStart
    && (isEndDateMissing || isTodayBeforeEnd));

  if (isLive) {
    scheduling = 'live';
  } else if (isTodayAfterEnd) {
    scheduling = 'expired';
  } else {
    scheduling = 'scheduled';
  }

  return [scheduling, start, end];
}

function getAudienceDetails(audienceIds, audienceList) {
  let name = '';

  if (!audienceIds || audienceIds.length === 0) {
    name = 'ALL VISITORS';
    return { name, id: null };
  }

  const audienceOverview = audienceList.find((audience) => audience.id === audienceIds[0]);
  name = audienceOverview ? audienceOverview.name || audienceOverview.type : 'AUDIENCE NOT FOUND';

  return { name, id: audienceIds[0] };
}

function buildCompleteActivity(activityDetails, activityOverview, audienceList) {
  let positionCounter = 0;
  const {
    experiences, locations, options, priority,
  } = activityDetails;

  // 1. Mesclar experiences com suas respectivas locations com base no locationLocalId
  const experiencesWithLocations = experiences.map((experience) => {
    positionCounter += 1;
    const enrichedExperience = { ...experience, position: positionCounter };

    const matchedMbox = experience.optionLocations.map((ol) => locations.mboxes.find(
      (mbox) => mbox.locationLocalId === ol.locationLocalId,
    )).find((m) => m); // Pega o primeiro encontrado

    enrichedExperience.mbox = matchedMbox;

    return enrichedExperience;
  });

  // 2. Mesclar options com experiences com base no optionLocalId
  const enrichedOptions = options.map((option) => {
    const correspondingExperience = experiencesWithLocations.find((experience) => experience
      .optionLocations.some((ol) => ol.optionLocalId === option.optionLocalId));

    if (correspondingExperience) {
      // Determina IDs de audiência baseado no tipo da atividade (AB vs XT)
      const audienceIds = activityOverview.type === 'ab'
        ? correspondingExperience.mbox?.audienceIds
        : correspondingExperience.audienceIds;

      return {
        ...option,
        audienceDetails: getAudienceDetails(audienceIds || [], audienceList),
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
        visitorPercentage: correspondingExperience.visitorPercentage
          ? correspondingExperience.visitorPercentage : 'N/A',
      };
    }
    return option;
  });

  // Limpeza e normalização de datas
  const activityCopy = { ...activityDetails };
  delete activityCopy.locations;
  delete activityCopy.experiences;

  if (!activityCopy.startsAt) activityCopy.startsAt = activityOverview.startsAt || 'when activated';
  if (!activityCopy.endsAt) activityCopy.endsAt = activityOverview.endsAt || 'when deactivated';

  const [scheduling] = getSchedulingAccordingToInterface(activityCopy);

  return {
    ...activityCopy,
    type: activityOverview.type,
    scheduling, // live, scheduled, expired
    options: enrichedOptions.sort((a, b) => a.ordination.position - b.ordination.position),
  };
}

// --- API REQUEST FUNCTIONS ---

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
    throw new Error(`Failed to fetch activities: ${JSON.stringify(details)}`);
  }
}

async function getActivityDetails(activityId, activityType) {
  if (!activityId) throw new Error('Activity ID is required');
  const normalizedType = normalizeString(activityType);
  const accessToken = await fetchAccessToken();

  try {
    const { data } = await axios.get(
      `${TARGET_API_BASE_URL}/${tenantId}/target/activities/${normalizedType}/${activityId}`,
      { headers: buildAuthHeaders(accessToken) },
    );
    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch activity details: ${JSON.stringify(details)}`);
  }
}

async function getAudiences() {
  const accessToken = await fetchAccessToken();
  try {
    const { data } = await axios.get(`${TARGET_API_BASE_URL}/${tenantId}/target/audiences`, {
      headers: buildAuthHeaders(accessToken),
    });
    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch audiences: ${JSON.stringify(details)}`);
  }
}

async function getOffers() {
  const accessToken = await fetchAccessToken();
  try {
    const { data } = await axios.get(`${TARGET_API_BASE_URL}/${tenantId}/target/offers`, {
      headers: buildAuthHeaders(accessToken),
    });
    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch offers: ${JSON.stringify(details)}`);
  }
}

async function getOfferDetails(offerId, offerType) {
  const accessToken = await fetchAccessToken();
  try {
    const { data } = await axios.get(
      `${TARGET_API_BASE_URL}/${tenantId}/target/offers/${offerType}/${offerId}`,
      { headers: buildAuthHeaders(accessToken) },
    );
    return data;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Failed to fetch offer details: ${JSON.stringify(details)}`);
  }
}

// --- ORCHESTRATION LOGIC ---

function buildOffersPromises(activity, listOffers) {
  const offersPromises = activity.options.map(async (option) => {
    // Busca metadados da oferta na lista geral para saber o tipo (html, json, etc)
    const offerOverview = listOffers.find((o) => o.id === option.offerId);
    // Se não achar na lista, tenta inferir ou usa padrão (ex: content)
    const type = offerOverview ? offerOverview.type : (option.type || 'content');

    // Busca o conteúdo completo da oferta
    const offerDetails = await getOfferDetails(option.offerId, type);

    const { scheduling, startsAt, endsAt } = activity;
    const meta = {
      scheduling: { status: scheduling, startsAt, endsAt },
      type: { activity: activity.type, offer: type },
    };

    const { id, content } = offerDetails;
    return { ...option, ...meta, offerDetails: { id, content } };
  });

  return offersPromises;
}

async function getActivityWithOffers(activityOverview, audienceList, offerList) {
  // 1. Busca detalhes da atividade
  const activityDetails = await getActivityDetails(activityOverview.id, activityOverview.type);

  // 2. Estrutura a atividade (vincula experiences -> options)
  const completeActivity = buildCompleteActivity(activityDetails, activityOverview, audienceList);

  // 3. Busca o conteúdo das ofertas para cada opção estruturada
  const offersPromises = buildOffersPromises(completeActivity, offerList);
  const offersResponses = await Promise.all(offersPromises);

  return { ...completeActivity, options: offersResponses };
}

async function getTravaTelasOffers() {
  // 1. Busca dados iniciais em paralelo (Atividades, Audiências, Ofertas)
  const [activitiesData, audiencesData, offersData] = await Promise.all([
    getActivities(),
    getAudiences(),
    getOffers(),
  ]);

  const activities = activitiesData.activities || [];
  const audienceList = audiencesData.audiences || [];
  const offerList = offersData.offers || [];

  // 2. Filtros iniciais (Nome, Status, Lifetime)
  const matchingActivities = activities.filter((activity) => (
    activity?.name?.includes(TRAVA_TELAS_IDENTIFIER)
  ));

  const approvedActivities = matchingActivities.filter((activity) => (
    normalizeString(activity?.state) === 'approved'
  ));

  const activeActivities = approvedActivities.filter(
    (activity) => !activity.lifetime || !activity.lifetime.end,
  );

  // 3. Processamento detalhado para cada atividade encontrada
  const results = await Promise.all(
    activeActivities.map(async (activity) => {
      try {
        return await getActivityWithOffers(activity, audienceList, offerList);
      } catch (error) {
        console.error(`Erro ao processar atividade ${activity.id}:`, error.message);
        return null;
      }
    }),
  );

  return results.filter((r) => r !== null);
}

module.exports = {
  fetchAccessToken,
  getActivities,
  getActivityDetails,
  getOfferDetails,
  getTravaTelasOffers,
};
