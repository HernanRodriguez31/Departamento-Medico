/**
 * HEADER MAESTRO - DEPARTAMENTO MEDICO BRISA
 * Incluye importaciones, inicialización y helpers críticos.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });
// Importaciones de SimpleWebAuthn (CRITICAS)
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');

// Inicializacion
admin.initializeApp();
const db = admin.firestore();

// Constantes de Base de Datos
const WEBAUTHN_RP_NAME = 'Departamento Medico Brisa';
const WEBAUTHN_USERS_COLLECTION = 'webauthn_users';
const WEBAUTHN_CHALLENGES_COLLECTION = '_webauthn_challenges';

// --- HELPERS GLOBALES (Para evitar errores de undefined) ---
const resolveWebOrigin = (req) => {
  const origin = req.headers?.origin;
  if (origin) return origin;
  const referer = req.headers?.referer;
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch (e) {}
  }
  return 'https://dm.brisasaludybienestar.com';
};

const resolveRpID = (origin) => {
  try {
    // Si viene con protocolo, extraemos el hostname
    if (origin && origin.startsWith('http')) {
      return new URL(origin).hostname;
    }
    return origin || 'dm.brisasaludybienestar.com';
  } catch (e) {
    console.error('Error parseando RP ID:', origin);
    return 'dm.brisasaludybienestar.com'; // Fallback seguro
  }
};

const setCorsHeaders = (res, origin) => {
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

const createWebauthnChallenge = async ({ type, uid, challenge, rpID, origin }) => {
  const docRef = db.collection(WEBAUTHN_CHALLENGES_COLLECTION).doc();
  await docRef.set({
    challenge,
    type,
    uid: uid || null,
    rpID,
    origin,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return docRef.id;
};

// A PARTIR DE AQUI VAN LOS EXPORTS (No tocar los exports existentes)
const messaging = admin.messaging();
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const ALLOWED_START = 8;
const ALLOWED_END = 22; // exclusive
const POSTS_COLLECTION = 'dm_posts';
const NOTIFICATIONS_COLLECTION = 'notifications';
const USERS_COLLECTION = 'usuarios';
const LIKE_RATE_LIMIT_MINUTES = 10;
const LIKE_RATE_LIMIT_MS = LIKE_RATE_LIMIT_MINUTES * 60 * 1000;
const LIKE_META_COLLECTION = '_meta';
const LIKE_META_DOC = 'like_notification';
const APP_FEED_ROUTE = '/app/#/feed';
const NOTIF_BODY_LIMIT = 140;
const AI_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AI_RATE_LIMIT_MAX = 20;
const aiRateLimitByUid = new Map();
const WEBAUTHN_CREDENTIALS_COLLECTION = 'webauthn_credentials';
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WEBAUTHN_RPID = process.env.WEBAUTHN_RPID || 'dm.brisasaludybienestar.com';
const DEFAULT_WEBAUTHN_ORIGIN =
  process.env.WEBAUTHN_ORIGIN || 'https://dm.brisasaludybienestar.com';

function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  return {};
}

function isChallengeExpired(createdAt) {
  if (!createdAt) return true;
  const createdMs = typeof createdAt.toMillis === 'function' ? createdAt.toMillis() : 0;
  if (!createdMs) return true;
  return Date.now() - createdMs > WEBAUTHN_CHALLENGE_TTL_MS;
}

function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();

  // Puede venir como array de parts:
  // - ChatCompletions style: [{type:"text", text:"..."}]
  // - Responses style: [{type:"input_text", text:"..."}]
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') {
        const text = part.trim();
        if (text) return text;
        continue;
      }
      if (typeof part === 'object') {
        const text = typeof part.text === 'string' ? part.text.trim() : '';
        const type = part.type;
        if (text && (!type || type === 'text' || type === 'input_text')) return text;
      }
    }
  }

  // Puede venir como objeto con {text:"..."}
  if (typeof content === 'object' && typeof content.text === 'string') return content.text.trim();

  return '';
}

function extractUserText(body) {
  if (!body || typeof body !== 'object') return '';

  if (typeof body.prompt === 'string' && body.prompt.trim()) return body.prompt.trim();
  if (typeof body.text === 'string' && body.text.trim()) return body.text.trim();
  if (typeof body.input === 'string' && body.input.trim()) return body.input.trim();

  if (Array.isArray(body.messages) && body.messages.length) {
    for (let i = body.messages.length - 1; i >= 0; i -= 1) {
      const message = body.messages[i];
      const role = (message?.role || '').toString();
      if (role !== 'user') continue;
      const text =
        extractTextFromContent(message?.content) ||
        extractTextFromContent(message?.input) ||
        extractTextFromContent(message?.text);
      if (text) return text;
    }
  }

  return '';
}

function allowAiRequest(uid) {
  if (!uid) return false;
  const now = Date.now();
  const windowStart = now - AI_RATE_LIMIT_WINDOW_MS;
  const recent = (aiRateLimitByUid.get(uid) || []).filter((ts) => ts > windowStart);
  recent.push(now);
  aiRateLimitByUid.set(uid, recent);
  return recent.length <= AI_RATE_LIMIT_MAX;
}

function extractOutputTextFromResponsesApi(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();

  const msg = Array.isArray(data.output) ? data.output.find((o) => o?.type === 'message') : null;
  const part = msg?.content?.find((c) => c?.type === 'output_text' && typeof c.text === 'string');
  if (part?.text?.trim()) return part.text.trim();

  return '';
}

function getLocalHour() {
  try {
    const hourStr = new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      hour12: false,
      timeZone: TIMEZONE
    }).format(new Date());
    const hour = parseInt(hourStr, 10);
    return Number.isNaN(hour) ? null : hour;
  } catch (e) {
    functions.logger.warn('No se pudo calcular la hora local', e);
    return null;
  }
}

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const snippet = (value, max = NOTIF_BODY_LIMIT) => {
  const text = cleanString(value);
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
};

const loadWebauthnChallenge = async (challengeId = '') => {
  if (!challengeId) return null;
  const ref = db.collection(WEBAUTHN_CHALLENGES_COLLECTION).doc(challengeId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { ref, data: snap.data() || {} };
};

const resolveUserName = async (uid) => {
  if (!uid) return '';
  try {
    const snap = await db.doc(`${USERS_COLLECTION}/${uid}`).get();
    if (!snap.exists) return '';
    const profile = snap.data() || {};
    const candidates = [
      profile.displayName,
      profile.nombreCompleto,
      profile.apellidoNombre,
      profile.fullName,
      profile.name,
      profile.nombre,
      profile.email,
      profile.correo,
      profile.mail
    ]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    return candidates[0] || '';
  } catch (e) {
    functions.logger.warn('No se pudo resolver nombre de usuario', { uid, error: e });
    return '';
  }
};

const normalizePushData = (data = {}) => {
  const normalized = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) return;
    normalized[key] = value === null ? '' : String(value);
  });
  return normalized;
};

const createNotificationDoc = async (payload = {}) => {
  if (!payload?.toUid) return null;
  try {
    const ref = await db.collection(NOTIFICATIONS_COLLECTION).add({
      ...payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
      readAt: null
    });
    return ref;
  } catch (e) {
    functions.logger.error('Error creando notificacion', { toUid: payload.toUid, error: e });
    return null;
  }
};

const sendPushToUid = async (uid, payload = {}) => {
  if (!uid) return null;

  let tokens = [];
  try {
    const tokenSnap = await db.doc(`pushTokens/${uid}`).get();
    const rawTokens = tokenSnap.exists ? tokenSnap.get('tokens') || [] : [];
    tokens = Array.from(
      new Set(
        rawTokens.filter((t) => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
      )
    );
  } catch (e) {
    functions.logger.error('Error leyendo tokens de destino', { uid, error: e });
    return null;
  }

  if (!tokens.length) {
    functions.logger.info('Sin tokens para el destinatario, se omite push', { uid });
    return null;
  }

  const multicast = {
    tokens,
    ...payload
  };

  if (payload.data) {
    multicast.data = normalizePushData(payload.data);
  }

  try {
    const response = await messaging.sendEachForMulticast(multicast);
    functions.logger.info('Push enviado', {
      uid,
      successCount: response.successCount,
      failureCount: response.failureCount
    });
    return response;
  } catch (e) {
    functions.logger.error('Error enviando push', { uid, error: e });
    return null;
  }
};

const shouldNotifyPostLike = async ({ postId, toUid, fromUid }) => {
  if (!postId) return false;
  const metaRef = db.doc(`${POSTS_COLLECTION}/${postId}/${LIKE_META_COLLECTION}/${LIKE_META_DOC}`);
  const now = admin.firestore.Timestamp.now();
  let allow = false;

  await db.runTransaction(async (trx) => {
    const snap = await trx.get(metaRef);
    const lastAt = snap.exists ? snap.get('lastNotifiedAt') : null;
    const lastMs = lastAt?.toMillis ? lastAt.toMillis() : 0;
    if (lastMs && now.toMillis() - lastMs < LIKE_RATE_LIMIT_MS) {
      allow = false;
      return;
    }
    trx.set(
      metaRef,
      {
        lastNotifiedAt: now,
        lastNotifiedByUid: fromUid || null,
        lastNotifiedToUid: toUid || null
      },
      { merge: true }
    );
    allow = true;
  });

  return allow;
};

exports.onChatMessageCreated = functions
  .region('us-central1')
  .firestore.document('dm_chats/{conversationId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    const targetUid = data.to;
    const conversationId = context.params.conversationId;
    const messageId = context.params.messageId;

    if (!targetUid) {
      functions.logger.info('Mensaje sin campo "to", no se envía push', { conversationId, messageId });
      return;
    }

    const currentHour = getLocalHour();
    if (currentHour === null || currentHour < ALLOWED_START || currentHour >= ALLOWED_END) {
      functions.logger.info('Fuera de horario permitido, no se envía push', {
        conversationId,
        messageId,
        hour: currentHour
      });
      return;
    }

    let tokens = [];
    try {
      const tokenSnap = await db.doc(`pushTokens/${targetUid}`).get();
      const rawTokens = tokenSnap.exists ? tokenSnap.get('tokens') || [] : [];
      tokens = Array.from(
        new Set(
          rawTokens.filter(t => typeof t === 'string' && t.trim().length > 0).map(t => t.trim())
        )
      );
    } catch (e) {
      functions.logger.error('Error leyendo tokens de destino', { targetUid, conversationId, messageId, error: e });
      return;
    }

    if (!tokens.length) {
      functions.logger.info('Sin tokens para el destinatario, se omite push', { targetUid, conversationId, messageId });
      return;
    }

    const body =
      typeof data.text === 'string' && data.text.trim()
        ? data.text.trim().slice(0, 120)
        : 'Tenés un mensaje nuevo';

    const multicast = {
      tokens,
      notification: {
        title: 'Nuevo mensaje',
        body
      },
      data: {
        conversationId: conversationId || '',
        from: data.from ? String(data.from) : '',
        to: targetUid || ''
      }
    };

    try {
      const response = await messaging.sendEachForMulticast(multicast);
      functions.logger.info('Push enviado', {
        conversationId,
        messageId,
        targetUid,
        successCount: response.successCount,
        failureCount: response.failureCount
      });
    } catch (e) {
      functions.logger.error('Error enviando push', { conversationId, messageId, targetUid, error: e });
    }
  });

exports.onPostCommentCreated = functions
  .region('us-central1')
  .firestore.document(`${POSTS_COLLECTION}/{postId}/comments/{commentId}`)
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    const postId = context.params.postId;
    const commentId = context.params.commentId;
    const fromUid = data.authorUid || data.uid || '';

    if (!postId || !fromUid) {
      functions.logger.info('Comentario sin postId o authorUid', { postId, commentId });
      return;
    }

    let postSnap = null;
    try {
      postSnap = await db.doc(`${POSTS_COLLECTION}/${postId}`).get();
    } catch (e) {
      functions.logger.error('Error leyendo post para comentario', { postId, commentId, error: e });
      return;
    }

    if (!postSnap?.exists) {
      functions.logger.warn('Post no encontrado para comentario', { postId, commentId });
      return;
    }

    const post = postSnap.data() || {};
    const toUid = post.authorUid || '';
    if (!toUid) {
      functions.logger.info('Post sin authorUid, se omite notificacion', { postId, commentId });
      return;
    }
    if (toUid === fromUid) {
      return;
    }

    const fromName = cleanString(data.authorName) || (await resolveUserName(fromUid)) || 'Usuario';
    const commentSnippet = snippet(data.text, 120);
    const title = 'Nuevo comentario';
    const body = commentSnippet || 'Comentaron tu publicacion';

    await createNotificationDoc({
      toUid,
      fromUid,
      fromName,
      type: 'post',
      entityId: postId,
      route: APP_FEED_ROUTE,
      title,
      body
    });

    const pushBody = snippet(
      commentSnippet ? `${fromName}: ${commentSnippet}` : `${fromName} comento tu publicacion`,
      140
    );

    await sendPushToUid(toUid, {
      notification: {
        title,
        body: pushBody
      },
      data: {
        type: 'post_comment',
        postId,
        commentId,
        route: APP_FEED_ROUTE,
        fromUid
      }
    });
  });

exports.onPostLikeCreated = functions
  .region('us-central1')
  .firestore.document(`${POSTS_COLLECTION}/{postId}/likes/{uid}`)
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    const postId = context.params.postId;
    const fromUid = data.authorUid || context.params.uid || '';

    if (!postId || !fromUid) {
      functions.logger.info('Like sin postId o uid', { postId, uid: context.params.uid });
      return;
    }

    let postSnap = null;
    try {
      postSnap = await db.doc(`${POSTS_COLLECTION}/${postId}`).get();
    } catch (e) {
      functions.logger.error('Error leyendo post para like', { postId, uid: fromUid, error: e });
      return;
    }

    if (!postSnap?.exists) {
      functions.logger.warn('Post no encontrado para like', { postId, uid: fromUid });
      return;
    }

    const post = postSnap.data() || {};
    const toUid = post.authorUid || '';
    if (!toUid) {
      functions.logger.info('Post sin authorUid, se omite notificacion', { postId, uid: fromUid });
      return;
    }
    if (toUid === fromUid) {
      return;
    }

    let allow = false;
    try {
      allow = await shouldNotifyPostLike({ postId, toUid, fromUid });
    } catch (e) {
      functions.logger.error('Error aplicando rate limit de likes', { postId, uid: fromUid, error: e });
      return;
    }

    if (!allow) {
      functions.logger.info('Rate limit activo para likes', { postId, uid: fromUid, toUid });
      return;
    }

    const fromName = (await resolveUserName(fromUid)) || 'Usuario';
    const title = 'Nuevo like';
    const body = `${fromName} le dio like a tu publicacion`;

    await createNotificationDoc({
      toUid,
      fromUid,
      fromName,
      type: 'post',
      entityId: postId,
      route: APP_FEED_ROUTE,
      title,
      body
    });

    await sendPushToUid(toUid, {
      notification: {
        title,
        body
      },
      data: {
        type: 'post_like',
        postId,
        route: APP_FEED_ROUTE,
        fromUid
      }
    });
  });

exports.aiChat = functions
  .region('us-central1')
  .runWith({ secrets: ['OPENAI_API_KEY', 'GEMINI_API_KEY'] })
  .https.onRequest(async (req, res) => {
    const startedAt = Date.now();
    let uid = null;
    let provider = 'unknown';

    const logAi = (status, extra = {}) => {
      functions.logger.info('aiChat', {
        uid,
        provider,
        status,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        ...extra
      });
    };

    const origin = req.get('origin') || '';
    const isAllowedOrigin =
      // Firebase Hosting default domains
      /^https:\/\/departamento-medico-brisa\.(web\.app|firebaseapp\.com)$/.test(origin) ||
      // Custom domains mapped to the same Hosting site (e.g. https://dm.brisasaludybienestar.com)
      /^https:\/\/([a-z0-9-]+\.)*brisasaludybienestar\.com$/i.test(origin) ||
      // Local development
      /^https?:\/\/localhost:\d+$/i.test(origin) ||
      /^https?:\/\/127\.0\.0\.1:\d+$/i.test(origin);

    if (origin && isAllowedOrigin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') {
      logAi(405, { error: 'method_not_allowed' });
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const authHeader = req.get('Authorization') || '';
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      logAi(401, { error: 'missing_auth' });
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    try {
      const decoded = await admin.auth().verifyIdToken(tokenMatch[1]);
      uid = decoded?.uid || null;
    } catch (error) {
      logAi(401, { error: 'invalid_auth' });
      return res.status(401).json({ ok: false, error: 'auth_invalid' });
    }

    if (!allowAiRequest(uid)) {
      logAi(429, { error: 'rate_limited' });
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }

    let body = {};
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch (e) {
        body = {};
      }
    }

    provider = typeof body.provider === 'string' ? body.provider.toLowerCase() : 'openai';
    if (provider !== 'openai' && provider !== 'gemini') {
      logAi(400, { error: 'invalid_provider' });
      return res.status(400).json({ ok: false, error: 'invalid_provider' });
    }

    const systemPrompt =
      'Sos el asistente del Departamento Médico Brisa. Respuestas claras, concisas y seguras. No inventes. Si falta info, pedí aclaración. En temas médicos, recordá que no reemplaza consulta.';

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        logAi(500, { error: 'missing_openai_api_key' });
        return res.status(500).json({ ok: false, error: 'missing_openai_api_key' });
      }

      const prompt = extractUserText(body);
      if (!prompt) {
        logAi(400, { error: 'missing_prompt' });
        return res.status(400).json({ ok: false, error: 'missing_prompt' });
      }

      const previousMessages = Array.isArray(body.previousMessages) ? body.previousMessages : [];
      const normalizedPreviousMessages = previousMessages
        .map((message) => {
          if (!message || typeof message !== 'object') return null;
          const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
          if (role !== 'user' && role !== 'assistant') return null;
          const content =
            extractTextFromContent(message.content) ||
            extractTextFromContent(message.text) ||
            extractTextFromContent(message.input);
          if (!content) return null;
          return { role, content };
        })
        .filter(Boolean);

      const today = new Date().toLocaleDateString('es-AR', { dateStyle: 'full' });
      const systemPromptWithDate = `${systemPrompt} Estás operando bajo la arquitectura GPT-4o Mini, la versión más eficiente de OpenAI. Hoy es ${today}.`;

      const messages = [
        { role: 'system', content: systemPromptWithDate },
        ...normalizedPreviousMessages,
        { role: 'user', content: prompt }
      ];

      const payload = {
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.2
      };

      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });

        const raw = await r.text();
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          data = null;
        }

        if (!r.ok) {
          const message =
            typeof data?.error?.message === 'string'
              ? data.error.message
              : typeof data?.message === 'string'
                ? data.message
                : '';
          const short = message.replace(/\s+/g, ' ').trim().slice(0, 200);
          const detail = short ? ` ${short}` : '';
          logAi(502, { error: `OpenAI: ${r.status}${detail}` });
          return res.status(502).json({ ok: false, error: `OpenAI: ${r.status}${detail}` });
        }

        const text = typeof data?.choices?.[0]?.message?.content === 'string'
          ? data.choices[0].message.content.trim()
          : '';

        if (!text) {
          logAi(502, { error: 'OpenAI: 502 empty_response' });
          return res.status(502).json({ ok: false, error: 'OpenAI: 502 empty_response' });
        }

        logAi(200);
        return res.status(200).json({ ok: true, text });
      } catch (err) {
        logAi(500, { error: 'OpenAI: 500 request_failed' });
        return res.status(500).json({ ok: false, error: 'OpenAI: 500 request_failed' });
      }
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      logAi(500, { error: 'missing_gemini_api_key' });
      return res.status(500).json({ ok: false, error: 'missing_gemini_api_key' });
    }

    const model =
      typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-2.5-flash';
    const fallbackModel =
      typeof body.fallbackModel === 'string' && body.fallbackModel.trim()
        ? body.fallbackModel.trim()
        : '';

    const historyContents = Array.isArray(body.historyContents)
      ? body.historyContents.filter(Boolean)
      : [];
    let contents = [];
    if (historyContents.length) {
      const prompt = extractUserText(body);
      if (!prompt) {
        logAi(400, { error: 'missing_prompt' });
        return res.status(400).json({ ok: false, error: 'missing_prompt' });
      }
      contents = historyContents.concat([{ role: 'user', parts: [{ text: prompt }] }]);
    } else {
      contents = Array.isArray(body.contents) ? body.contents.filter(Boolean) : [];
      if (!contents.length) {
        const prompt = extractUserText(body);
        if (!prompt) {
          logAi(400, { error: 'missing_prompt' });
          return res.status(400).json({ ok: false, error: 'missing_prompt' });
        }
        contents = [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Entendido.' }] },
          { role: 'user', parts: [{ text: prompt }] }
        ];
      }
    }

    const modelsToTry = [model, fallbackModel].filter(Boolean).filter((value, index, arr) => (
      arr.indexOf(value) === index
    ));

    let lastError = 'Gemini: 500 request_failed';
    for (const modelName of modelsToTry) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            modelName
          )}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
          }
        );

        const raw = await r.text();
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          data = null;
        }

        if (!r.ok) {
          const message =
            typeof data?.error?.message === 'string'
              ? data.error.message
              : typeof data?.message === 'string'
                ? data.message
                : '';
          const short = message.replace(/\s+/g, ' ').trim().slice(0, 200);
          const detail = short ? ` ${short}` : '';
          lastError = `Gemini: ${r.status}${detail}`;
          continue;
        }

        const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
          ? data.candidates[0].content.parts
          : [];
        const text = parts
          .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
          .filter(Boolean)
          .join('\n')
          .trim();

        if (!text) {
          lastError = 'Gemini: 502 empty_response';
          continue;
        }

        logAi(200, { provider: 'gemini' });
        return res.status(200).json({ ok: true, text });
      } catch (err) {
        lastError = 'Gemini: 500 request_failed';
      }
    }

    logAi(502, { error: lastError });
    return res.status(502).json({ ok: false, error: lastError });
  });

exports.webauthnRegisterStart = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    const origin = resolveWebOrigin(req);
    setCorsHeaders(res, origin);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      if (!db) throw new Error("La base de datos 'db' no está inicializada.");
      if (!isoBase64URL) throw new Error("La librería 'isoBase64URL' no está importada.");
      if (!generateRegistrationOptions) {
        throw new Error("La función 'generateRegistrationOptions' no está disponible.");
      }

      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

      const authHeader = req.get('Authorization') || '';
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) return res.status(401).json({ ok: false, error: 'auth_required' });

      const decoded = await admin.auth().verifyIdToken(tokenMatch[1]);
      const uid = decoded?.uid;
      if (!uid) return res.status(401).json({ ok: false, error: 'auth_invalid' });
      const email = decoded?.email || '';

      const rpID = resolveRpID(origin);
      console.log(`🔍 Debug Registro: UID=${uid}, RPID=${rpID}, Origin=${origin}`);

      const userRef = db.collection(WEBAUTHN_USERS_COLLECTION).doc(uid);
      const userSnap = await userRef.get();
      const storedCreds =
        userSnap.exists && Array.isArray(userSnap.data()?.credentials) ? userSnap.data().credentials : [];

      if (storedCreds.length) {
        return res.status(200).json({ ok: true, alreadyRegistered: true });
      }

      const excludeCredentials = storedCreds
        .map((cred) => {
          if (!cred?.id) return null;
          try {
            return {
              id: isoBase64URL.toBuffer(cred.id),
              type: 'public-key',
              transports: cred.transports || []
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      const options = await generateRegistrationOptions({
        rpName: WEBAUTHN_RP_NAME,
        rpID,
        userID: new Uint8Array(Buffer.from(uid)),
        userName: email || uid,
        timeout: 60000,
        attestationType: 'none',
        excludeCredentials,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required'
        }
      });

      if (!options || !options.challenge) {
        console.error('🔥 Error: generateOptions devolvió undefined', options);
        throw new Error('Failed to generate challenge');
      }

      const challengeId = await createWebauthnChallenge({
        type: 'registration',
        uid,
        challenge: options.challenge,
        rpID,
        origin
      });

      console.log('✅ Opciones de registro generadas con éxito');
      return res.status(200).json({ ok: true, options, challengeId });
    } catch (error) {
      console.error('🔥 ERROR FATAL EN REGISTRO:', error);
      return res.status(500).json({ ok: false, error: error.message, stack: error.stack });
    }
  });

exports.webauthnRegisterFinish = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    const origin = resolveWebOrigin(req);
    setCorsHeaders(res, origin);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      const { body } = req;

      // 1. Validar Usuario (Token)
      const authHeader = req.get('Authorization') || '';
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) return res.status(401).json({ error: 'auth_required' });
      const decoded = await admin.auth().verifyIdToken(tokenMatch[1]);
      const uid = decoded.uid;
      // 2. Validar Challenge
      const challengeId = req.query.challengeId || body.challengeId;
      const challengeRef = db.collection(WEBAUTHN_CHALLENGES_COLLECTION).doc(challengeId);
      const challengeSnap = await challengeRef.get();
      if (!challengeSnap.exists) {
        throw new Error('Challenge not found (Register)');
      }
      const challengeData = challengeSnap.data();
      await challengeRef.delete();

      // 3. Verificar Registro
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: challengeData.origin,
        expectedRPID: challengeData.rpID,
        requireUserVerification: true
      });
      if (verification.verified) {
        const { credential } = verification.registrationInfo;

        // 4. GUARDAR EN EL LUGAR CORRECTO ('webauthn_users')
        const newCredential = {
          id: isoBase64URL.fromBuffer(credential.id),
          publicKey: isoBase64URL.fromBuffer(credential.publicKey),
          counter: credential.counter,
          transports: body.response.transports || [],
          deviceType: credential.credentialDeviceType,
          backedUp: credential.credentialBackedUp,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const userRef = db.collection('webauthn_users').doc(uid);
        const userDoc = await userRef.get();

        let credentials = [];
        if (userDoc.exists) {
          credentials = userDoc.data().credentials || [];
        }

        credentials.push(newCredential);

        await userRef.set(
          {
            email: decoded.email,
            credentials
          },
          { merge: true }
        );
        console.log(`✅ Credencial guardada correctamente para usuario ${uid}`);
        return res.status(200).json({ ok: true, verified: true });
      }
      throw new Error('Verification failed');
    } catch (error) {
      console.error('🔥 RegisterFinish Error:', error);
      return res.status(500).json({ error: error.message });
    }
  });

exports.webauthnLoginStart = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    const origin = resolveWebOrigin(req);
    setCorsHeaders(res, origin);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      const rpID = resolveRpID(origin);
      console.log('🔍 LoginStart:', { origin, rpID });

      const options = await generateAuthenticationOptions({
        rpID,
        timeout: 60000,
        userVerification: 'required'
      });

      if (!options || !options.challenge) {
        console.error('🔥 Error: generateOptions devolvió undefined', options);
        throw new Error('Failed to generate challenge');
      }

      const challengeId = await createWebauthnChallenge({
        type: 'authentication',
        challenge: options.challenge,
        rpID,
        origin
      });

      console.log('✅ LoginStart OK:', challengeId);
      return res.status(200).json({ ok: true, options, challengeId });
    } catch (error) {
      console.error('🔥 LoginStart Error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

exports.webauthnLoginFinish = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    const origin = resolveWebOrigin(req);
    setCorsHeaders(res, origin);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      // Usamos req.body directamente por seguridad
      const body = req.body;
      const credential = body.credential || body;
      const response = credential.response || body.response;
      const challengeId = req.query.challengeId || body.challengeId;
      console.log('🔍 Iniciando LoginFinish para challengeId:', challengeId);
      // 1. Validar Challenge
      if (!challengeId) return res.status(400).json({ ok: false, error: 'missing_challenge' });
      const challengeRef = db.collection(WEBAUTHN_CHALLENGES_COLLECTION).doc(challengeId);
      const challengeSnap = await challengeRef.get();
      if (!challengeSnap.exists) {
        console.error('❌ Challenge no encontrado o expirado');
        return res.status(400).json({ ok: false, error: 'challenge_not_found' });
      }
      const challengeData = challengeSnap.data();
      await challengeRef.delete().catch(() => {}); // Borrar para evitar reuso
      // 2. Identificar al Usuario (Decodificación robusta)
      let uid = null;
      const userHandle = response?.userHandle;
      if (userHandle) {
        try {
          // Intenta decodificar desde base64url (lo estándar)
          uid = isoBase64URL.toBuffer(userHandle).toString('utf-8');
        } catch (e) {
          try {
            // Intenta decodificar desde base64 estándar (fallback)
            uid = Buffer.from(userHandle, 'base64').toString('utf-8');
          } catch (err) {
            console.error('Error decodificando userHandle:', err);
            uid = null;
          }
        }
      }
      if (!uid) {
        console.error('⚠️ No se pudo recuperar el UID del userHandle.');
        throw new Error('User identification failed');
      }
      console.log('👤 Usuario identificado:', uid);
      // 3. Obtener credenciales del USUARIO (Directamente del perfil)
      const userRef = db.collection(WEBAUTHN_USERS_COLLECTION).doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) throw new Error('User not found in DB');
      const userCreds = Array.isArray(userSnap.data()?.credentials) ? userSnap.data().credentials : [];
      const credentialId = credential.id;
      // Buscamos la credencial en el array del usuario
      const currentCred = userCreds.find((c) => c.id === credentialId);
      if (!currentCred) {
        console.error('❌ Credencial no encontrada en el perfil del usuario');
        throw new Error('Credential not found');
      }
      // 4. Verificar Firma
      const verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challengeData.challenge,
        expectedOrigin: challengeData.origin,
        expectedRPID: challengeData.rpID,
        authenticator: {
          credentialID: isoBase64URL.toBuffer(currentCred.id),
          credentialPublicKey: isoBase64URL.toBuffer(currentCred.publicKey),
          counter: currentCred.counter || 0,
          transports: currentCred.transports || []
        }
      });
      if (verification.verified) {
        console.log('✅ Verificación exitosa. Generando token...');
        // Actualizar contador en la base de datos
        currentCred.counter = verification.authenticationInfo.newCounter;
        await userRef.update({ credentials: userCreds });
        // Generar la llave maestra de Firebase
        const token = await admin.auth().createCustomToken(uid);
        return res.status(200).json({ ok: true, verified: true, token, customToken: token });
      } else {
        throw new Error('Verification failed');
      }
    } catch (error) {
      console.error('🔥 LoginFinish Critical Error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

// Actualizacion forzada
