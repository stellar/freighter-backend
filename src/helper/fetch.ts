// Why does NodeJS.fetch.RequestInfo not work for URL?
export function fetchWithTimeout(
  url: any,
  opts?: RequestInit,
): ReturnType<typeof fetch> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);

  return fetch(url, {
    ...opts,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(id);
  });
}
