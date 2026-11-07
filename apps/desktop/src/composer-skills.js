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
        const path=`${directory}/SKILL.md`;let description='使用此技能处理当前任务';
        try{
          const file=await read(`/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(path)}`,signal);
          const front=file.text?.match(/^---\r?\n([\s\S]*?)\r?\n---/);const line=front?.[1].match(/^description:\s*(.+)$/m)?.[1];
          if(line&&!['|','>'].includes(line))description=line.replace(/^["']|["']$/g,'');
        }catch(error){if(signal?.aborted)throw error;}
        return {name:entry.name,path,kind:'skill',source:`${base}/skills`,description};
      }));
      skills.push(...batch.filter(Boolean));
    }
  }
  return skills;
}
