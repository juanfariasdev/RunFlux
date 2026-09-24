export async function callHttp(
  method: string,
  url: unknown,
  headers: unknown,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('http-output: "url" is empty or invalid');
  }
  const upperMethod = method.toUpperCase();
  const requestHeaders: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
  const init: RequestInit = { method: upperMethod, headers: requestHeaders };
  if (upperMethod !== 'GET' && upperMethod !== 'HEAD' && body !== undefined) {
    if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-type')) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    init.body = JSON.stringify(body);
  }

  const response = await fetchImpl(url, init);
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const contentType = response.headers.get('content-type') ?? '';
  const rawBody = await response.text();
  let parsedBody: unknown = rawBody;
  if (contentType.includes('application/json')) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }
  }

  if (!response.ok) {
    throw new Error(`http-output: request to ${url} failed with status ${response.status}: ${rawBody.slice(0, 200)}`);
  }

  return { status: response.status, headers: responseHeaders, body: parsedBody };
}

