// Why does NodeJS.fetch.RequestInfo not work for URL?
export function fetchWithTimeout(
  url: any,
  opts?: NodeJS.fetch.RequestInit
): Promise<NodeJS.fetch.Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);

  return fetch(url, {
    ...opts,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(id);
  });
}
