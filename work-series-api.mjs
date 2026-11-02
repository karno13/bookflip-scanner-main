// Series are user annotations, not automatically validated bibliographic facts.
export function listWorkSeries(repository) {
  return repository.database.prepare(
    'SELECT work_id AS workId, series, volume FROM work_series_annotations ORDER BY series, volume'
  ).all();
}
export function updateWorkSeries(repository, workId, input) {
  if (typeof workId !== 'string' || !workId || workId.length > 200) throw Object.assign(Error('INVALID_WORK_ID'), { statusCode: 400 });
  const exists = repository.database.prepare('SELECT id FROM works WHERE id = ?').get(workId);
  if (!exists) throw Object.assign(Error('WORK_NOT_FOUND'), { statusCode: 404 });
  const name = typeof input?.series === 'string' ? input.series.trim() : '';
  const volume = input?.volume;
  if (!name && (volume === null || volume === undefined || volume === '')) {
    repository.database.prepare('DELETE FROM work_series_annotations WHERE work_id = ?').run(workId);
    return { workId, series: null, volume: null };
  }
  if (!name || name.length > 120 || !Number.isSafeInteger(volume) || volume < 1 || volume > 10000)
    throw Object.assign(Error('INVALID_SERIES_ANNOTATION'), { statusCode: 400 });
  repository.database.prepare(
    `INSERT INTO work_series_annotations (work_id,series,volume,updated_at)
     VALUES (?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET
     series=excluded.series,volume=excluded.volume,updated_at=excluded.updated_at`
  ).run(workId, name, volume, new Date().toISOString());
  return { workId, series: name, volume };
}
