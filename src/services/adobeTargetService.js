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
  'Content-Type': 'application/vnd.adobe.target.v2+json',
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

async function updateOfferContent(offerId, offerType, content, workspace = null) {
  const accessToken = await fetchAccessToken();
  const contentToSend = typeof content === 'object' ? JSON.stringify(content) : content;
  const payload = { content: contentToSend };

  if (workspace) {
    payload.workspace = workspace;
  }

  try {
    const { data } = await axios.put(
      `${TARGET_API_BASE_URL}/${tenantId}/target/offers/${offerType}/${offerId}`,
      payload,
      { headers: buildAuthHeaders(accessToken) },
    );

    return data;
  } catch (error) {
    console.error(`Error updating offer ${offerId}: ${error.message}`);
    throw new Error(`Failed to update offer ${offerId}: ${error.message}`);
  }
}

async function updateActivity(activityId, activityType, activityPayload) {
  const accessToken = await fetchAccessToken();
  const normalizedType = normalizeString(activityType);

  try {
    const { data } = await axios.put(
      `${TARGET_API_BASE_URL}/${tenantId}/target/activities/${normalizedType}/${activityId}`,
      activityPayload,
      { headers: buildAuthHeaders(accessToken) },
    );

    return data;
  } catch (error) {
    console.error(`Error updating activity ${activityId}: ${error.message}`);
    throw new Error(`Failed to update activity ${activityId}: ${error.message}`);
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

function processContentName(content, dateSuffix) {
  if (!content) return { newContent: content, changed: false };

  const contentIsString = typeof content === 'string';
  let parsedContent = content;

  if (contentIsString) {
    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to parse content: ${error.message}`);
      return { newContent: content, changed: false };
    }
  }

  if (typeof parsedContent !== 'object' || parsedContent === null) {
    return { newContent: content, changed: false };
  }

  const payload = parsedContent.payload || {};
  if (!payload.nomeOferta) {
    return { newContent: content, changed: false };
  }

  const currentName = payload.nomeOferta.toString().trim();
  const baseName = currentName.replace(/-\d{8}$/, '').replace(/-+$/, '');
  const updatedName = `${baseName}-${dateSuffix}`;

  if (updatedName === currentName) {
    return { newContent: content, changed: false };
  }

  const updatedContent = { ...parsedContent, payload: { ...payload, nomeOferta: updatedName } };
  const finalContent = contentIsString ? JSON.stringify(updatedContent) : updatedContent;

  return { newContent: finalContent, changed: true };
}

async function updateTravaTelasOffersDate(targetActivityId = null) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const formattedDate = `${yyyy}${mm}${dd}`;

  console.log('[updateTravaTelasOffersDate] Iniciando processo de atualização', {
    targetActivityId,
    formattedDate,
  });

  const offers = await getTravaTelasOffers(targetActivityId);
  const uniqueActivities = new Map();

  offers.forEach(({ activityId, activityType }) => {
    const key = `${activityType}-${activityId}`;
    if (!uniqueActivities.has(key)) {
      uniqueActivities.set(key, { activityId, activityType });
    }
  });

  const activityEntries = Array.from(uniqueActivities.values());

  const activityResults = await Promise.all(activityEntries.map(async ({
    activityId,
    activityType,
  }) => {
    console.log(`[updateTravaTelasOffersDate] Processando atividade ${activityId} (${activityType})`);
    const activityDetail = await getActivityDetails(activityId, activityType);
    if (!activityDetail || !Array.isArray(activityDetail.options)) {
      console.log(`[updateTravaTelasOffersDate] Atividade ${activityId} sem opções válidas, ignorando.`);
      return { updated: 0 };
    }

    const activityOffers = offers.filter((offer) => offer.activityId == activityId);
    let activityNeedsUpdate = false;
    let updatedInActivity = 0;

    const updatedOptions = await Promise.all(activityDetail.options.map(async (option) => {
      const optionType = normalizeString(option.type || 'json');
      const hasEmbeddedContent = Boolean(option.content);
      const optionIdentifier = `${option.offerId || option.optionLocalId}`;

      // Cenário A: Shared Offer (possui offerId, porém sem content incorporado)
      if (option.offerId && !hasEmbeddedContent) {
        console.log(`[updateTravaTelasOffersDate] Oferta compartilhada ${optionIdentifier} detectada.`);
        const optionOffer = activityOffers.find((offer) => offer.offerId == option.offerId);
        const offerType = optionOffer ? optionOffer.offerType : (option.type || 'json');
        let offerContent = optionOffer?.offer?.content || null;

        if (!offerContent) {
          console.log(`[updateTravaTelasOffersDate] Buscando detalhes da oferta ${optionIdentifier}.`);
          const offerDetails = await getOfferDetails(option.offerId, offerType);
          offerContent = offerDetails.content;
        }

        const { newContent, changed } = processContentName(offerContent, formattedDate);

        if (changed) {
          console.log(`[updateTravaTelasOffersDate] Atualizando oferta compartilhada ${optionIdentifier}.`);
          await updateOfferContent(option.offerId, offerType, newContent, activityDetail.workspace);
          updatedInActivity += 1;
          activityNeedsUpdate = true;
        }

        console.log(`[updateTravaTelasOffersDate] Oferta compartilhada ${optionIdentifier} verificada. Mudou: ${changed}`);

        return option;
      }

      // Cenário B: Embedded Offer (conteúdo dentro da própria option)
      if (hasEmbeddedContent && optionType === 'json') {
        console.log(`[updateTravaTelasOffersDate] Oferta embutida ${optionIdentifier || 'sem-id'} detectada.`);
        const { newContent, changed } = processContentName(option.content, formattedDate);

        if (changed) {
          console.log(`[updateTravaTelasOffersDate] Conteúdo embutido alterado para ${optionIdentifier || 'sem-id'}.`);
          updatedInActivity += 1;
          activityNeedsUpdate = true;
          return { ...option, content: newContent };
        }

        console.log(`[updateTravaTelasOffersDate] Oferta embutida ${optionIdentifier || 'sem-id'} sem alterações.`);
      }

      return option;
    }));

    if (activityNeedsUpdate) {
      console.log(`[updateTravaTelasOffersDate] Atualizando atividade ${activityId} para refletir mudanças.`);
      const activityPayload = { ...activityDetail, options: updatedOptions };
      delete activityPayload.stateComputed;
      delete activityPayload.revisions;
      delete activityPayload.workspace;

      await updateActivity(activityId, activityType, activityPayload);
    } else {
      console.log(`[updateTravaTelasOffersDate] Nenhuma atualização necessária para atividade ${activityId}.`);
    }

    return { updated: updatedInActivity };
  }));

  const updatedCount = activityResults.reduce((total, result) => total + result.updated, 0);

  return { updatedCount, totalOffers: offers.length, date: formattedDate };
}

module.exports = {
  updateActivity,
  getTravaTelasOffers,
  updateTravaTelasOffersDate,
};
