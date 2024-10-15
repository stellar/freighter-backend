// Why does NodeJS.fetch.RequestInfo not work for URL?
// incompatible Fetch definitions between Blockaid and urql libs mean that we can't type this correctly
// and use it in both libs.
export function fetchWithTimeout(
  url: any, // its RequestInfo | URL but urql uses an incorrect fetch definition that clashes with Core.Fetch
  opts?: Record<string, any>,
): any {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);

  return fetch(url, {
    ...opts,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(id);
  });
}
