export function codeLines(text, diff=false) {
  let oldLine=0,newLine=0,added=0,removed=0;
  const all=text.split('\n');if(all.at(-1)==='')all.pop();
  const rows=all.map((text,index)=>{
    if(diff && text.startsWith('diff --git ')){oldLine=0;newLine=0;return {text,kind:'meta'};}
    if(!diff)return {text,line:index+1,kind:'plain'};
    const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);return {text,kind:'hunk'};}
    if(!oldLine&&!newLine || text.startsWith('\\'))return {text,kind:'meta'};
    if(text.startsWith('+')){added++;return {text,line:newLine++,kind:'added'};}
    if(text.startsWith('-')){removed++;return {text,line:oldLine++,kind:'removed'};}
    if(text.startsWith(' ')){oldLine++;return {text,line:newLine++,kind:'plain'};}
    return {text,kind:'meta'};
  });
  return {rows:rows.filter(row=>!['meta','hunk'].includes(row.kind)).slice(0,5000),clipped:rows.length>5000,added,removed};
}
