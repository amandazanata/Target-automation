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

// --- FUNÇÕES AUXILIARES DE ESTRUTURAÇÃO ---

const getAudienceDetails = (audienceIds = [], audienceList = []) => {
  if (!audienceIds || audienceIds.length === 0) {
    return { name: 'ALL VISITORS', id: null };
  }
  const audienceOverview = audienceList.find((audience) => audience.id === audienceIds[0]);
  const name = audienceOverview
    ? audienceOverview.name || audienceOverview.type
    : 'AUDIENCE NOT FOUND';

  return { name, id: audienceIds[0] };
};

const buildCompleteActivity = (activityDetails, activityOverview, audienceList = []) => {
  const {
    experiences = [],
    locations,
    options = [],
    priority,
  } = activityDetails;

  // 1. Vincular Experiências às suas Locations (Mbox)
  const experiencesWithLocations = experiences.map((experience, index) => {
    const mbox = experience.optionLocations && experience.optionLocations.length > 0
      ? locations.mboxes.find(
        (loc) => loc.locationLocalId === experience.optionLocations[0].locationLocalId,
      )
      : null;

    return {
      ...experience,
      position: index + 1,
      mbox,
    };
  });

  // 2. Vincular Opções (que contêm o offerId) às Experiências
  const enrichedOptions = options.reduce((acc, option) => {
    const correspondingExperience = experiencesWithLocations.find((experience) => (
      experience.optionLocations && experience.optionLocations.some(
        (ol) => ol.optionLocalId === option.optionLocalId,
      )
    ));

    if (correspondingExperience) {
      let audienceIds;
      if (activityOverview.type === 'ab') {
        if (correspondingExperience.mbox) {
          audienceIds = correspondingExperience.mbox.audienceIds;
        } else {
          audienceIds = [];
        }
      } else {
        audienceIds = correspondingExperience.audienceIds;
      }

      acc.push({
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
      });
    }
    return acc;
  }, []);

  // Remove metadados pesados que não precisamos mais
  const activityCopy = { ...activityDetails };
  delete activityCopy.locations;
  delete activityCopy.experiences;

  return {
    ...activityCopy,
    type: activityOverview.type,
    options: enrichedOptions.sort((a, b) => a.ordination.position - b.ordination.position),
  };
};

// --- CHAMADAS DE API ---

async function getActivities(params = {}) {
  const accessToken = await fetchAccessToken();
  try {
    const { data } = await axios.get(`${TARGET_API_BASE_URL}/${tenantId}/target/activities`, {
      headers: buildAuthHeaders(accessToken),
      params,
    });
    return data;
  } catch (error) {
    throw new Error(`Failed to fetch activities: ${error.message}`);
  }
}

async function getActivityDetails(activityId, activityType) {
  const accessToken = await fetchAccessToken();
  const normalizedType = normalizeString(activityType);
  try {
    const { data } = await axios.get(
      `${TARGET_API_BASE_URL}/${tenantId}/target/activities/${normalizedType}/${activityId}`,
      { headers: buildAuthHeaders(accessToken) },
    );
    return data;
  } catch (error) {
    console.error(`Error fetching details for activity ${activityId}: ${error.message}`);
    return null; // Retorna null para tratar erros graciosamente
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
    console.warn('Failed to fetch audiences, continuing without audience names.');
    return { audiences: [] };
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
    console.warn('Failed to fetch offers list, defaulting to standard lookup.');
    return { offers: [] };
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
    console.error(`Error fetching offer ${offerId}: ${error.message}`);
    return { id: offerId, content: null, error: error.message };
  }
}

async function updateOfferContent(offerId, offerType, content) {
  const accessToken = await fetchAccessToken();

  try {
    const { data } = await axios.put(
      `${TARGET_API_BASE_URL}/${tenantId}/target/offers/${offerType}/${offerId}`,
      { content },
      { headers: buildAuthHeaders(accessToken) },
    );

    return data;
  } catch (error) {
    console.error(`Error updating offer ${offerId}: ${error.message}`);
    throw new Error(`Failed to update offer ${offerId}: ${error.message}`);
  }
}

async function buildOffersContent(activity, listOffers) {
  const promises = activity.options.map(async (option) => {
    // Tenta achar na lista geral para saber o tipo correto (html, json, redirect, etc)
    const offerMeta = listOffers.find((o) => o.id === option.offerId);
    // Se não achar, assume 'content' ou o tipo que já estiver na option, fallback para 'json'
    const type = offerMeta ? offerMeta.type : (option.type || 'json');

    // Busca o conteúdo real da oferta
    const details = await getOfferDetails(option.offerId, type);

    return {
      activityId: activity.id,
      activityName: activity.name,
      activityType: normalizeString(activity.type),
      status: activity.state,
      offerId: option.offerId,
      offerType: type,
      offer: details, // O conteúdo completo da oferta
      experienceName: option.experience ? option.experience.name : 'Unknown',
      audience: option.audienceDetails ? option.audienceDetails.name : 'All Visitors',
    };
  });

  return Promise.all(promises);
}

async function getTravaTelasOffers(targetActivityId = null) {
  // 1. Buscar listas base em paralelo
  const [activitiesData, audiencesData, offersData] = await Promise.all([
    getActivities(),
    getAudiences(),
    getOffers(),
  ]);

  const activities = activitiesData.activities || [];
  const audienceList = audiencesData.audiences || [];
  const offerList = offersData.offers || [];

  // 2. Filtrar Atividades (Nome e Status)
  const approvedActivities = activities.filter((activity) => {
    if (targetActivityId) {
      return activity?.id?.toString() === targetActivityId.toString();
    }

    return (
      activity?.name?.includes(TRAVA_TELAS_IDENTIFIER)
      && normalizeString(activity?.state) === 'approved'
    );
  });

  // 3. Processar cada atividade
  const results = await Promise.all(
    approvedActivities.map(async (activityOverview) => {
      // Filtro de Lifetime (Atividades "Evergreen" / Sem data de fim)
      // Verificamos primeiro no overview para economizar chamadas
      const hasLifetimeEndInOverview = activityOverview.lifetime && activityOverview.lifetime.end;
      if (hasLifetimeEndInOverview) return [];

      // Busca detalhes completos
      const activityDetails = await getActivityDetails(activityOverview.id, activityOverview.type);
      if (!activityDetails) return [];

      // Verificação dupla de lifetime nos detalhes (caso a lista esteja desatualizada/incompleta)
      const hasLifetimeEndInDetails = activityDetails.lifetime && activityDetails.lifetime.end;
      if (hasLifetimeEndInDetails) return [];

      // Estrutura a atividade relacionando Exp -> Option
      const structuredActivity = buildCompleteActivity(
        activityDetails,
        activityOverview,
        audienceList,
      );

      // Busca o conteúdo das ofertas encontradas
      const activityOffers = await buildOffersContent(structuredActivity, offerList);
      return activityOffers;
    }),
  );

  // Flatten para retornar uma lista única de ofertas
  return results.flat();
}

async function updateTravaTelasOffersDate(targetActivityId = null) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const formattedDate = `${yyyy}${mm}${dd}`;

  const offers = await getTravaTelasOffers(targetActivityId);

  const updatePromises = offers.map(async (offerData) => {
    const { offerId, offerType, offer } = offerData;
    let { content } = offer;

    if (!content) return false;

    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch (error) {
        console.warn(`Failed to parse content for offer ${offerId}: ${error.message}`);
        return false;
      }
    }

    const payload = content.payload || {};
    if (!payload.nomeOferta) return false;

    const currentName = payload.nomeOferta.toString();
    const baseName = currentName.replace(/-\d{8}$/, '');
    const updatedName = `${baseName}-${formattedDate}`;

    if (updatedName === currentName) return false;

    const updatedContent = { ...content, payload: { ...payload, nomeOferta: updatedName } };

    await updateOfferContent(offerId, offerType, updatedContent);
    return true;
  });

  const results = await Promise.all(updatePromises);
  const updatedCount = results.filter(Boolean).length;

  return { updatedCount, totalOffers: offers.length, date: formattedDate };
}

module.exports = {
  getTravaTelasOffers,
  updateTravaTelasOffersDate,
};
