export function identificationProgress(statuses = {}) {
  const count=key=>Math.max(0,Number(statuses[key])||0);
  const total=Object.values(statuses).reduce((sum,value)=>sum+Math.max(0,Number(value)||0),0);
  const completed=count('completed'),review=count('review_required'),failed=count('failed');
  const processed=completed+review+failed;
  const pending=count('queued')+count('running')+count('retry_wait');
  return {total,processed,completed,review,failed,pending,percent:total?Math.round(processed/total*100):0};
}
