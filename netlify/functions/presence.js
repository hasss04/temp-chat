exports.handler = async function (event) {
  const roomId = event.queryStringParameters?.roomId || null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      function: 'presence',
      roomId,
      method: event.httpMethod
    })
  };
};