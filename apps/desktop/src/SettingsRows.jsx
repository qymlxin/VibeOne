import React from 'react';

export function SettingsGroup({title,description,children}){
 return <section className="desktop-settings-section"><h2>{title}</h2>{description&&<p>{description}</p>}<div className="desktop-settings-card">{children}</div></section>;
}
export function SettingsRow({title,description,children}){
 return <div className="desktop-settings-row"><div><strong>{title}</strong>{description&&<p>{description}</p>}</div>{children}</div>;
}
export function SettingsSwitch({label,checked,disabled,onChange}){
 return <button type="button" className="desktop-settings-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={()=>onChange(!checked)}><span/></button>;
}
