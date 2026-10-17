// Ein einheitliches, skalierbares Katzen-Icon mit 35 Gesichtsausdrücken.
export const MOODS = [
  ['traurig','Traurig','sad','frown','sad','tear'],
  ['aengstlich','Ängstlich','wide','oh','worried','sweat'],
  ['zufrieden','Zufrieden','soft','smile','none',''],
  ['gluecklich','Glücklich','happy','laugh','none','blush'],
  ['verwirrt','Verwirrt','uneven','wavy','uneven',''],
  ['muede','Müde','sleep','yawn','none','zzz'],
  ['unzufrieden','Unzufrieden','half','frown','flat',''],
  ['aufgewuehlt','Aufgewühlt','uneven','oh','worried','swirls'],
  ['wuetend','Wütend','angry','teeth','angry','anger'],
  ['genervt','Genervt','side','flat','flat',''],
  ['verbunden','Verliebt / verbunden','heart','smile','none','hearts'],
  ['einsam','Einsam','sad','tiny','sad',''],
  ['gestresst','Gestresst','squint','teeth','worried','sweat'],
  ['dankbar','Dankbar','shine','smile','soft','blush'],
  ['vorfreude','Voller Vorfreude','shine','laugh','up','sparkles'],
  ['entspannt','Entspannt','closed','cat','none',''],
  ['erleichtert','Erleichtert','closed','oh','soft','sigh'],
  ['geborgen','Geborgen','happy','cat','none','hug'],
  ['stolz','Stolz','soft','grin','up','sparkles'],
  ['zuversichtlich','Zuversichtlich','up','smile','up',''],
  ['selbstbewusst','Selbstbewusst','wink','grin','up',''],
  ['motiviert','Motiviert','open','grin','determined','sparkles'],
  ['neugierig','Neugierig','up','tiny','uneven',''],
  ['ueberrascht','Überrascht','wide','oh','up',''],
  ['sehnsuechtig','Sehnsüchtig','up','tiny','sad','heart'],
  ['nervoes','Nervös','side','wavy','worried','sweat'],
  ['unsicher','Unsicher','sad','wavy','uneven',''],
  ['ueberfordert','Überfordert','spiral','oh','worried','swirls'],
  ['enttaeuscht','Enttäuscht','down','frown','sad',''],
  ['frustriert','Frustriert','squint','frown','angry','sigh'],
  ['verletzt','Verletzt','shine','frown','sad','tear'],
  ['beschaemt','Beschämt','down','tiny','worried','blush'],
  ['besorgt','Besorgt','open','frown','worried',''],
  ['leer','Innerlich leer','blank','flat','none',''],
  ['gelangweilt','Gelangweilt','half','tiny','flat','']
].map(([code,label,eyes,mouth,brows,extra]) => Object.freeze({code,label,eyes,mouth,brows,extra}));
export const moodByCode = code => MOODS.find(mood => mood.code === code);

const heart = (x,y,size=16) => `<path transform="translate(${x} ${y}) scale(${size/20})" d="M0 5 C-13-4-13-17-4-17 C0-17 3-14 4-11 C9-21 24-17 20-6 C17 0 10 5 4 11Z" fill="#ed6e8c" stroke="#512e37" stroke-width="1.5"/>`;
function eye(kind,x,side) {
  let y=111;
  if(kind==='uneven') y+=side===0?-5:5;
  if(kind==='heart') return heart(x-3,115,22);
  if(kind==='closed'||kind==='sleep') return `<path d="M${x-14} 112 Q${x} 123 ${x+14} 112" fill="none"/>`;
  if(kind==='happy') return `<path d="M${x-14} 115 Q${x} 97 ${x+14} 115" fill="none"/>`;
  if(kind==='squint'||(kind==='wink'&&side===1)) return `<path d="M${x-12} 100 L${x+9} 111 L${x-12} 121" fill="none"/>`;
  if(kind==='spiral') return `<path d="M${x} 111 c-9-7-15 5-9 11 c11 12 29-3 19-17 c-10-14-33-4-29 12" fill="none"/>`;
  if(kind==='blank') return `<circle cx="${x}" cy="${y}" r="4" fill="#49303a" stroke="none"/>`;
  const height=kind==='wide'?23:kind==='shine'?22:kind==='soft'?14:kind==='half'||kind==='side'?10:18;
  const pupilX=x+(kind==='side'?7:kind==='up'?4:0),pupilY=y+(kind==='down'?7:kind==='up'?-6:0);
  let result=`<ellipse cx="${x}" cy="${y}" rx="16" ry="${height}" fill="#fff9e9"/><ellipse cx="${pupilX}" cy="${pupilY}" rx="${kind==='wide'?7:9}" ry="${Math.min(height-3,14)}" fill="#49303a" stroke="none"/>`;
  if(kind!=='down'&&kind!=='half'&&kind!=='side') result+=`<circle cx="${pupilX-3}" cy="${pupilY-4}" r="4" fill="white" stroke="none"/>`;
  if(kind==='shine') result+=`<circle cx="${pupilX+4}" cy="${pupilY+6}" r="2.5" fill="white" stroke="none"/>`;
  if(kind==='sad') result+=`<path d="M${x-17} 101 L${x+17} 106" fill="none"/>`;
  if(kind==='angry') result+=`<path d="M${x-17} ${side?104:94} L${x+17} ${side?94:104}" fill="none"/>`;
  return result;
}
function brows(kind) {
  const paths={sad:'M65 88 Q77 89 89 78 M131 78 Q143 89 155 88',worried:'M65 89 Q77 83 89 83 M131 83 Q143 83 155 89',flat:'M65 88 H89 M131 88 H155',angry:'M65 79 L91 91 M129 91 L155 79',determined:'M65 82 L91 88 M129 88 L155 82',up:'M65 79 Q77 69 89 79 M131 79 Q143 69 155 79',uneven:'M65 80 Q77 68 89 78 M131 88 L155 88',soft:'M67 87 Q78 81 88 85 M132 85 Q142 81 153 87'};
  return paths[kind]?`<path d="${paths[kind]}" fill="none" stroke-width="4"/>`:'';
}
function mouth(kind) {
  const paths={smile:'M91 151 Q110 169 129 151',cat:'M90 151 Q101 165 110 151 Q119 165 130 151',frown:'M92 163 Q110 145 128 163',flat:'M95 156 H125',wavy:'M91 157 Q100 148 110 157 Q120 166 130 157',tiny:'M104 155 H116'};
  if(paths[kind]) return `<path d="${paths[kind]}" fill="none"/>`;
  if(kind==='oh'||kind==='yawn') return `<ellipse cx="110" cy="161" rx="${kind==='yawn'?15:9}" ry="${kind==='yawn'?19:12}" fill="#633b43"/>`;
  if(kind==='teeth') return '<rect x="91" y="151" width="38" height="16" rx="6" fill="#fff9e9"/><path d="M91 159 H129 M103 153 V166 M117 153 V166" stroke-width="2"/>';
  return `<path d="M88 149 Q110 159 132 149 Q128 180 110 180 Q92 180 88 149Z" fill="${kind==='grin'?'#fff9e9':'#633b43'}"/>${kind==='laugh'?'<path d="M99 173 Q110 164 121 173" stroke="#ed8799" stroke-width="9"/>':''}`;
}
function extra(kind) {
  const map={
    tear:'<path d="M62 125 Q50 143 62 148 Q74 144 62 125Z" fill="#92d1df" stroke-width="2"/>',
    sweat:'<path d="M172 70 Q157 91 171 97 Q185 92 172 70Z" fill="#92d1df" stroke-width="2"/>',
    blush:'<g stroke="none" fill="#ee8696" opacity=".7"><ellipse cx="63" cy="140" rx="14" ry="8"/><ellipse cx="157" cy="140" rx="14" ry="8"/></g>',
    zzz:'<path d="M172 58 H188 L172 74 H188 M187 35 H203 L187 51 H203" fill="none" stroke="#b1a0d7" stroke-width="4"/>',
    swirls:'<path d="M18 77 q-14-15 1-20 q18-4 10 11 M191 58 q18-15 20 2 q0 15-10 12" fill="none" stroke="#b1a0d7" stroke-width="4"/>',
    anger:'<path d="M179 45 v10 h10 M195 40 v10 h10 M177 67 h10 v10 M197 62 h10 v10" fill="none" stroke="#e46978" stroke-width="4"/>',
    sigh:'<path d="M144 162 Q174 153 178 168 Q190 161 194 173 Q190 186 160 178" fill="#fff9e9" stroke="#a7a6be" stroke-width="2"/>',
    sparkles:'<g fill="#ffe3a4" stroke="#ad7757" stroke-width="2"><path d="M29 48 l4 9 9 4-9 4-4 9-4-9-9-4 9-4Z"/><path d="M189 83 l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/></g>',
    hug:'<path d="M50 179 Q80 165 104 185 M170 179 Q140 165 116 185" fill="none" stroke="#e5a675" stroke-width="18"/><path d="M61 175 l7 9 M72 174 l7 8 M159 175 l-7 9 M148 174 l-7 8" stroke-width="2"/>',
    heart:heart(179,57,18),hearts:heart(179,57,18)+heart(25,82,12)
  };
  return map[kind]||'';
}
export function catSvg(code) {
  const m=moodByCode(code); if(!m) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" fill="none" aria-hidden="true" focusable="false"><ellipse cx="110" cy="202" rx="64" ry="7" fill="#000" opacity=".12"/><g stroke="#51363a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M42 87 Q30 49 38 25 Q66 29 87 58 Q110 50 133 58 Q154 29 182 25 Q190 49 178 87 Q196 110 188 146 Q178 190 110 193 Q42 190 32 146 Q24 110 42 87Z" fill="#eebb8c"/><path d="M47 43 L53 80 L75 63Z M173 43 L167 80 L145 63Z" fill="#e99a9d" stroke-width="2"/><path d="M96 59 l3 18 M110 56 v20 M124 59 l-3 18" stroke="#cd8d61" stroke-width="5"/><ellipse cx="110" cy="151" rx="45" ry="30" fill="#fff0d6" stroke="none"/>${brows(m.brows)}${eye(m.eyes,77,0)}${eye(m.eyes,143,1)}<path d="M103 137 Q110 133 117 137 L110 144Z" fill="#d8798f" stroke-width="2.5"/>${mouth(m.mouth)}<path d="M48 137 L22 132 M48 147 L20 149 M172 137 L198 132 M172 147 L200 149" stroke-width="2.5"/>${extra(m.extra)}</g></svg>`;
}

export function catNode(code, className='') {
  const el=document.createElement('span'); el.className=`mood-cat ${className}`.trim();
  // Nur lokal definierte SVG-Teile; keine vom Server gelieferten Texte als Markup.
  el.innerHTML=catSvg(code); el.setAttribute('aria-hidden','true'); return el;
}
