// Discover only project-local skills through the same authorized tree API as @.
// No local-machine paths leak into a remote device's requests.
export async function discoverComposerSkills(read, sessionId, signal) {
  const tree = path => read(`/sessions/${encodeURIComponent(sessionId)}/tree?path=${encodeURIComponent(path)}`, signal);
  const root = await tree('.');
  const skills = [];
  for (const base of ['.agents', '.claude']) {
    if (!root.entries?.some(entry => entry.name === base && entry.kind === 'directory')) continue;
    const parent = await tree(base);
    if (!parent.entries?.some(entry => entry.name === 'skills' && entry.kind === 'directory')) continue;
    const catalog = await tree(`${base}/skills`);
    const candidates = (catalog.entries ?? []).filter(entry => entry.kind === 'directory').slice(0,50);
    // Bound filesystem traffic even when a project has many installed skills.
    for (let offset=0;offset<candidates.length;offset+=4) {
      const batch=await Promise.all(candidates.slice(offset,offset+4).map(async entry=>{
        const directory=entry.path.replace(/^\.\//,'');
        const contents=await tree(directory);
        if (!contents.entries?.some(file=>file.name==='SKILL.md'&&file.kind==='file')) return null;
        return {name:entry.name,path:`${directory}/SKILL.md`,kind:'skill',source:`${base}/skills`,description:`使用项目技能 · ${directory}`};
      }));
      skills.push(...batch.filter(Boolean));
    }
  }
  return skills;
}
