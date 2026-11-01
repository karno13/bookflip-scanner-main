// Shared HTTP JSON request helper.
export async function json(url, options, fetcher = fetch) {
  const response = await fetcher(url, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `HTTP_${response.status}`);
  return data;
}
