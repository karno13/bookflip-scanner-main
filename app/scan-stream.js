// Decode newline-delimited JSON from the scanner response.
export async function readSearchStream(response, onProgress = () => {}) {
  if (!response.body) throw Error('STREAM_UNAVAILABLE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  let failure = null;
  const consume = (line) => {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    if (data.type === 'progress') onProgress(data.event);
    if (data.type === 'result') result = data.result;
    if (data.type === 'error') failure = data.error;
  };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(consume);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (failure) throw Error(failure);
  if (!result) throw Error('SEARCH_FAILED');
  return result;
}
