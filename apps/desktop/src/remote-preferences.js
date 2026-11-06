// Runtime address wins for the visible IP; saved port 0 remains an explicit intent.
// URL fallback keeps older Hosts, which do not publish configuration, usable.
export function remotePreferences(state) {
  const configuration=state?.configuration;
  let address;
  try { if(state?.url) address=new URL(state.url); } catch { /* Fall back to confirmed configuration. */ }
  const savedPort=configuration?.port;
  return {
    ip:address?.hostname.replace(/^\[|\]$/g,'') || configuration?.ip || state?.suggestedIp || '',
    port:String(Number.isInteger(savedPort)&&savedPort>=0&&savedPort<=65535?savedPort:address?.port||0),
  };
}
