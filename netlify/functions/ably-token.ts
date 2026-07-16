import type { Handler } from '@netlify/functions';
import Ably from 'ably';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: 'ABLY_API_KEY not configured' }),
    };
  }
  const peerId = event.queryStringParameters?.peerId?.trim() || `anon-${Date.now()}`;
  const client = new Ably.Rest(apiKey);
  try {
    const tokenRequest = await client.auth.createTokenRequest({
      clientId: peerId,
      // Colon = namespace wildcard in Ably. 'tempchat:*' matches every
      // channel named 'tempchat:<anything>'. A plain 'tempchat-*' is
      // treated as a literal string and matches nothing real.
      capability: JSON.stringify({
        'tempchat:*': ['publish', 'subscribe', 'presence'],
      }),
      ttl: 60 * 60 * 1000,
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
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};