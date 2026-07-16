import type { Handler } from '@netlify/functions';
import Ably from 'ably';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    console.error('[ably-token] Missing ABLY_API_KEY');
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
      body: JSON.stringify({ error: 'ABLY_API_KEY not configured' }),
    };
  }

  const peerIdRaw = event.queryStringParameters?.peerId?.trim();
  const peerId = peerIdRaw && peerIdRaw.length > 0 ? peerIdRaw : `anon-${Date.now()}`;

  try {
    const client = new Ably.Rest(apiKey);

    const capability = JSON.stringify({
      'tempchat-room-*': ['publish', 'subscribe', 'presence'],
    });

    const tokenRequest = await client.auth.createTokenRequest({
      clientId: peerId,
      capability,
      ttl: 60 * 60 * 1000,
    });

    console.log('[ably-token] token request created', {
      peerId,
      capability,
      keyName: tokenRequest.keyName,
      clientId: tokenRequest.clientId,
      ttl: tokenRequest.ttl,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...corsHeaders,
      },
      body: JSON.stringify(tokenRequest),
    };
  } catch (error) {
    console.error('[ably-token] createTokenRequest failed', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};