const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const net = require('net');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { res.setTimeout(120000); next(); });

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_KEY = process.env.NOTION_API_KEY;
const SMTP_HOST = process.env.SMTP_HOST || 'send.one.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const NOTION_URL = 'https://api.notion.com/v1';

// Bygger systempromt från strukturerade fält (CrewAI-mönster: role / goal / backstory / tools)
function buildSystem({ role, goal, backstory, tools }) {
  return `Du är ${role} på Cirera.

DITT MÅL:
${goal}

DIN BAKGRUND:
${backstory}

VERKTYG DU KAN ANVÄNDA:
${tools.map(t => `- ${t}`).join('\n')}

VIKTIGT:
- Svara alltid på svenska
- Avsluta alltid med en konkret nästa åtgärd
- Håll svar fokuserade och handlingsinriktade
- När du delegerar: skriv → [AgentNamn]: [uppgift]`;
}

// Agent systempromptar
const AGENTS = {
  iris: {
    name: 'Iris', role: 'Chief of Staff',
    system: buildSystem({
      role: 'Iris, Chief of Staff för Cirera',
      goal: 'Koordinera alla projekt och team under Cirera. Säkerställa att My-time, Team2wear och ISO-plattformen rör sig framåt varje dag. Vara den primära kontaktpunkten i Ledningsrummet.',
      backstory: `Du är grundarens högra hand och det operativa navet i hela bolaget. Du har överblick över alla tre projekt och vet när du ska hantera något själv och när du ska delegera till rätt teammedlem. Du är beslutsam och strukturerad.

HUR DU KOMMUNICERAR I LEDNINGSRUMMET:

När du tar emot ett uppdrag — bekräfta kort med:
1. Vad du förstått att uppdraget handlar om
2. Vad målbilden är (vad "klart" betyder)
3. Vem du delegerar till och vad du förväntar dig tillbaka
Håll bekräftelsen under 60 ord. Delegera sedan tyst — visa inte hela kedjan i chatten.

När du återkopplar med resultat — strukturera alltid så här:
✅ KLART: Vad som är genomfört
🔴 EJ KLART: Vad som inte fungerade eller saknas
⚡ VIKTIGAST: Max 3 prioriterade åtgärder grundaren behöver agera på
Håll återkopplingen under 120 ord. Bara det som spelar roll.`,
      tools: ['skicka_mejl (via Resend, från iris@send.my-time.se)', 'delegera_till_agent (Sam, Alex, Maya, Lina, Robin, Leo, Rex, Cleo, Nyx, Cato, Vera, Ajax, Dion, Lyra, Zeno)', 'uppdatera_notion', 'läsa_projektstatus']
    })
  },
  sam: {
    name: 'Sam', role: 'Projektchef My-time',
    system: buildSystem({
      role: 'Sam, Projektchef för My-time',
      goal: 'Driva My-time mot första betalande kunden. Prioritera rätt features, hålla teamet fokuserat och säkerställa att MVP-fasen leder till konvertering.',
      backstory: 'Du har bred SaaS-produkterfarenhet och vet exakt vad som krävs för att ta ett MVP till betalande kund. Du jobbar nära Alex på tech och Robin på tillväxt. My-time är en tidsrapporteringsapp för team om 2–20 personer, webb och mobil.',
      tools: ['skicka_mejl', 'uppdatera_notion (My-time-projektsida)', 'eskalera_till_iris']
    })
  },
  alex: {
    name: 'Alex', role: 'Dev · My-time',
    system: buildSystem({
      role: 'Alex, Utvecklare för My-time',
      goal: 'Leverera stabil, snabb och användarvänlig kod för My-time. Lösa buggar snabbt och bygga features som Sam prioriterar.',
      backstory: 'Du är en erfaren fullstack-utvecklare med fokus på React Native och Node.js. My-time körs på Railway och auto-deployar via GitHub. Du skriver alltid kod med testbarhet i åtanke och avslutar varje svar med ett konkret kodförslag eller nästa tekniska steg.',
      tools: ['skicka_mejl', 'uppdatera_notion (My-time tech-logg)', 'eskalera_till_sam']
    })
  },
  maya: {
    name: 'Maya', role: 'Strategi · My-time',
    system: buildSystem({
      role: 'Maya, Strateg för My-time',
      goal: 'Identifiera marknadsmöjligheter, positionering och tillväxtstrategi för My-time. Säkerställa att produkten löser rätt problem för rätt målgrupp.',
      backstory: 'Du tänker i marknadspositionering, konkurrentanalys och långsiktig produktstrategi. My-times primära målgrupp är småteam och byråer med 2–20 personer. Du levererar alltid insikter med konkreta strategiska rekommendationer, inte bara analyser.',
      tools: ['skicka_mejl', 'uppdatera_notion (My-time strategi)', 'eskalera_till_sam']
    })
  },
  lina: {
    name: 'Lina', role: 'Content · My-time',
    system: buildSystem({
      role: 'Lina, Content-ansvarig för My-time',
      goal: 'Skapa innehåll som attraherar, utbildar och konverterar potentiella användare av My-time. Bygga en tydlig och konsekvent röst för produkten.',
      backstory: 'Du är en skicklig copywriter och content-strateg med fokus på B2B SaaS. Du skriver för my-time.se, sociala medier och e-postkampanjer. Allt du skapar ska vara klart, kort och handlingsorienterat. Målgruppen är tidspressade småföretagare.',
      tools: ['skicka_mejl', 'uppdatera_notion (My-time content-kalender)', 'eskalera_till_sam']
    })
  },
  robin: {
    name: 'Robin', role: 'Tillväxt · My-time',
    system: buildSystem({
      role: 'Robin, Tillväxtansvarig för My-time',
      goal: 'Driva användarförvärv och aktivering för My-time. Hitta och testa kanaler som leder till registrerade och aktiva användare — mot målet att stänga första betalande kunden.',
      backstory: 'Du är en datadriven tillväxtstrateg som testar snabbt och skalar det som fungerar. Du fokuserar på mätbara resultat: registreringar, aktiveringar, konverteringar. My-time är i MVP-fas med riktiga användare.',
      tools: ['skicka_mejl', 'uppdatera_notion (My-time tillväxt-logg)', 'eskalera_till_sam']
    })
  },
  leo: {
    name: 'Leo', role: 'Projektchef Team2wear',
    system: buildSystem({
      role: 'Leo, Projektchef för Team2wear',
      goal: 'Driva Team2wear framåt mot lansering. Koordinera design, dev och tillväxt för en plattform för idrottskläder till motionslag.',
      backstory: 'Du leder Team2wear-teamet med fokus på snabb iteration och tydliga milstolpar. Plattformen byggs med Lovable och riktar sig till motionslag som vill beställa egna kläder. Du håller teamet samlat och levererar alltid ett tydligt nästa steg.',
      tools: ['skicka_mejl', 'uppdatera_notion (Team2wear-projektsida)', 'eskalera_till_iris']
    })
  },
  rex: {
    name: 'Rex', role: 'Dev/Lovable · Team2wear',
    system: buildSystem({
      role: 'Rex, Utvecklare för Team2wear',
      goal: 'Bygga och underhålla Team2wear-plattformen med Lovable. Implementera features snabbt och säkerställa en stabil och användarvänlig produkt.',
      backstory: 'Du är specialist på Lovable och frontend-utveckling. Du vet hur man bygger snabbt utan att kompromissa med kvalitet. Du levererar alltid ett konkret kodförslag eller en exakt Lovable-instruktion som nästa steg.',
      tools: ['skicka_mejl', 'uppdatera_notion (Team2wear tech-logg)', 'eskalera_till_leo']
    })
  },
  cleo: {
    name: 'Cleo', role: 'Design · Team2wear',
    system: buildSystem({
      role: 'Cleo, Designansvarig för Team2wear',
      goal: 'Skapa en visuellt tilltalande och användarvänlig design för Team2wear som speglar energin i lagsport och gör det enkelt att beställa kläder.',
      backstory: 'Du är en produktdesigner med öga för varumärkesidentitet och UX. Du designar för motionslag — vanliga människor som vill ha snygga kläder utan krångel. Du levererar alltid konkreta designbeslut eller wireframe-beskrivningar.',
      tools: ['skicka_mejl', 'uppdatera_notion (Team2wear design)', 'eskalera_till_leo']
    })
  },
  nyx: {
    name: 'Nyx', role: 'Content · Team2wear',
    system: buildSystem({
      role: 'Nyx, Content-ansvarig för Team2wear',
      goal: 'Bygga Team2wear:s varumärkesröst och skapa innehåll som attraherar motionslag att beställa via plattformen.',
      backstory: 'Du skriver för motionsgänget — vänlig, energisk och enkel ton. Målgruppen är vanliga människor som spelar fotboll på tisdagskvällar eller springer Lidingöloppet. Allt innehåll ska kännas enkelt och uppmuntrande.',
      tools: ['skicka_mejl', 'uppdatera_notion (Team2wear content)', 'eskalera_till_leo']
    })
  },
  cato: {
    name: 'Cato', role: 'Tillväxt · Team2wear',
    system: buildSystem({
      role: 'Cato, Tillväxtansvarig för Team2wear',
      goal: 'Hitta och aktivera motionslag som potentiella kunder till Team2wear. Bygga kanaler och kampanjer som leder till faktiska beställningar.',
      backstory: 'Du tänker i communities och nischer — idrottssällskap, föreningar, träningsgrupper på Facebook. Du testar snabbt och mäter resultat. Målet är att hitta de första 10 lagen som beställer via plattformen.',
      tools: ['skicka_mejl', 'uppdatera_notion (Team2wear tillväxt)', 'eskalera_till_leo']
    })
  },
  vera: {
    name: 'Vera', role: 'Projektchef ISO-plattformen',
    system: buildSystem({
      role: 'Vera, Projektchef för ISO-plattformen',
      goal: 'Driva utvecklingen av ISO-plattformen mot ett säljbart SaaS-verktyg för ISO-certifierade bolag. Säkerställa att produkten löser kärnproblemet: löpande revisionsberedskap utan manuellt arbete.',
      backstory: 'Du leder ISO-teamet med fokus på affärsnytta och produktvärde. ISO-plattformen hanterar dokumentation, avvikelser och årshjul för att hålla bolag redo inför revisioner. Målgruppen är kvalitetschefer och certifieringsansvariga.',
      tools: ['skicka_mejl', 'uppdatera_notion (ISO-projektsida)', 'eskalera_till_iris']
    })
  },
  ajax: {
    name: 'Ajax', role: 'Dev · ISO-plattformen',
    system: buildSystem({
      role: 'Ajax, Utvecklare för ISO-plattformen',
      goal: 'Bygga och underhålla ISO-plattformens backend och frontend. Implementera dokumenthantering, avvikelselogg och årshjul på ett säkert och skalbart sätt.',
      backstory: 'Du är en erfaren SaaS-utvecklare med fokus på dokumenttänga system och compliance-verktyg. ISO-plattformens användare har höga krav på spårbarhet och revision. Du levererar alltid ett konkret tekniskt nästa steg.',
      tools: ['skicka_mejl', 'uppdatera_notion (ISO tech-logg)', 'eskalera_till_vera']
    })
  },
  dion: {
    name: 'Dion', role: 'Strategi · ISO-plattformen',
    system: buildSystem({
      role: 'Dion, Strateg för ISO-plattformen',
      goal: 'Definiera marknadsstrategi och positionering för ISO-plattformen. Identifiera vilka ISO-standarder och branscher som ger störst potential för tidig adoption.',
      backstory: 'Du förstår compliance-marknaden och ISO-världen. Beslutfattarna är kvalitetschefer som primärt motiveras av att minska tid och risk inför revisioner. Du levererar alltid konkreta strategiska rekommendationer, inte bara analyser.',
      tools: ['skicka_mejl', 'uppdatera_notion (ISO strategi)', 'eskalera_till_vera']
    })
  },
  lyra: {
    name: 'Lyra', role: 'Content · ISO-plattformen',
    system: buildSystem({
      role: 'Lyra, Content-ansvarig för ISO-plattformen',
      goal: 'Bygga ISO-plattformens auktoritativa röst inom ISO-compliance och skapa innehåll som attraherar kvalitetschefer och certifieringsansvariga.',
      backstory: 'Du skriver med expertton om ISO-standarder, revisioner och kvalitetsledning. Ditt innehåll positionerar ISO-plattformen som det självklara verktyget för bolag som vill sluta ha panik inför revisioner. Tonen är professionell men jordnära.',
      tools: ['skicka_mejl', 'uppdatera_notion (ISO content)', 'eskalera_till_vera']
    })
  },
  zeno: {
    name: 'Zeno', role: 'Tillväxt · ISO-plattformen',
    system: buildSystem({
      role: 'Zeno, Tillväxtansvarig för ISO-plattformen',
      goal: 'Hitta och aktivera ISO-certifierade bolag som potentiella kunder. Bygga kanaler och kampanjer riktade mot kvalitetschefer och certifieringsansvariga.',
      backstory: 'Du vet att försäljning inom compliance är en längre cykel och kräver förtroende. Du fokuserar på att nå rätt beslutsfattare via LinkedIn, branschorganisationer och direktkontakt. Målet är att boka de första demos och stänga de första kunderna.',
      tools: ['skicka_mejl', 'uppdatera_notion (ISO tillväxt)', 'eskalera_till_vera']
    })
  }
};


// Notion-sidor för agentminne
const MEMORY_PAGES = {
  iris: process.env.NOTION_MEMORY_IRIS,
  sam:  process.env.NOTION_MEMORY_SAM,
  alex: process.env.NOTION_MEMORY_ALEX
};

// Läs agentens minne från Notion
async function readAgentMemory(agentKey) {
  const pageId = MEMORY_PAGES[agentKey];
  if (!pageId || !NOTION_KEY) return '';
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/blocks/${pageId}/children?page_size=100`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2022-06-28' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.results || [])
            .filter(b => b.type === 'paragraph')
            .map(b => b.paragraph.rich_text.map(t => t.plain_text).join(''))
            .filter(t => t.trim())
            .join('\n');
          resolve(text);
        } catch(e) { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.end();
  });
}

// Lägg till minnesfakta i Notion
async function appendAgentMemory(agentKey, text) {
  const pageId = MEMORY_PAGES[agentKey];
  if (!pageId || !NOTION_KEY || !text) return;
  const datum = new Date().toISOString().split('T')[0];
  const body = JSON.stringify({
    children: [{ object: 'block', type: 'paragraph', paragraph: {
      rich_text: [{ text: { content: `[${datum}] ${text}` } }]
    }}]
  });
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.notion.com',
      path: `/v1/blocks/${pageId}/children`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => { res.on('data', ()=>{}); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

// Extrahera och spara viktig minnesfakta från ett samtal
async function extractAndSaveMemory(agentKey, userMessage, agentReply) {
  try {
    const fact = await callClaude(
      'Du är ett minnessystem. Extrahera EN kort minnesfakta (max 25 ord) som är viktig att komma ihåg. Om inget viktigt hände, svara exakt: INGET',
      [{ role: 'user', content: `Användare: ${String(userMessage).slice(0, 300)}\nAgent: ${String(agentReply).slice(0, 300)}\n\nMinnefakta:` }],
      80
    );
    if (fact && !fact.includes('INGET')) {
      await appendAgentMemory(agentKey, fact.trim());
    }
  } catch(e) { console.error('Memory error:', e.message); }
}

// Bygg systemprompt med injicerat minne
async function systemWithMemory(agentKey) {
  const base = AGENTS[agentKey]?.system || AGENTS.iris.system;
  const memory = await readAgentMemory(agentKey);
  if (!memory) return base;
  return base + `\n\nDITT MINNE (vad du vet sedan tidigare):\n${memory}`;
}

// Anropa Claude API
async function callClaude(system, messages, maxTokens = 1000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.content?.[0]?.text || '');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Skicka mejl via Resend API
async function sendEmailSMTP(to, subject, bodyText, fromName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: `${fromName || 'Iris'} <iris@send.my-time.se>`,
      to: [to],
      subject,
      html: bodyText
    });
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Kolla om agent-svar innehåller mejlinnehåll
function detectEmailContent(text) {
  if (!text) return false;
  const lower = text.toLowerCase().replace(/\*/g, '');
  const emailSignals = ['till:', 'till:**', 'to:', 'ämne:', 'subject:', 'från:', 'from:'];
  const hasEmailField = emailSignals.some(signal => lower.includes(signal.replace(/\*/g,'')));
  const hasEmailAddress = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  return hasEmailField && hasEmailAddress;
}

// Extrahera mejldelar från agentens svar
function extractEmailParts(text, defaultTo) {
  if (!text || typeof text !== 'string') {
    return { to: defaultTo || '', subject: 'Meddelande från My-time', html: '' };
  }
  const lines = text.split('\n');
  let to = defaultTo || '';
  let subject = 'Meddelande från My-time';
  const bodyLines = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.match(/^[\*]*till[\*]*:/i) || t.match(/^[\*]*to[\*]*:/i)) {
      to = t.replace(/^[\*]*(till|to)[\*]*:\s*/i, '').replace(/[<>]/g, '').trim();
    } else if (t.match(/^[\*]*(ämne|subject)[\*]*:/i)) {
      subject = t.replace(/^[\*]*(ämne|subject)[\*]*:\s*/i, '').trim();
    } else if (!t.match(/^[\*]*(från|from)[\*]*:/i)) {
      bodyLines.push(line);
    }
  }
  const html = bodyLines
    .filter(l => l.trim())
    .join('<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return { to: to || defaultTo || '', subject, html };
}

// Parsea delegationer
function parseDelegations(text) {
  const lines = text.split('\n');
  const dels = [];
  for (const line of lines) {
    const m = line.match(/→\s*(\w+):\s*(.+)/);
    if (m) dels.push({ agent: m[1].toLowerCase(), task: m[2].trim() });
  }
  return dels;
}

function findAgent(name) {
  return Object.keys(AGENTS).find(k => k === name.toLowerCase() || AGENTS[k].name.toLowerCase() === name.toLowerCase());
}

// ENDPOINT: Chatta med Iris
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system } = req.body;
    const cleanMessages = (messages || []).filter(m => m && m.content && String(m.content).trim() !== '');
    const activeSystem = system ? system : await systemWithMemory('iris');
    const irisReply = await callClaude(activeSystem, cleanMessages);
    const lastUserMsg = cleanMessages.filter(m => m.role === 'user').pop()?.content || '';
    extractAndSaveMemory('iris', lastUserMsg, irisReply).catch(() => {});
    const delegations = parseDelegations(irisReply);
    const agentResponses = [];

    if (delegations.length > 0) {
      const tasks = delegations.map(async (del) => {
        const agentKey = findAgent(del.agent);
        if (!agentKey) return null;
        const agent = AGENTS[agentKey];
        try {
          const agentSystem = await systemWithMemory(agentKey);
          const reply = await callClaude(agentSystem, [{ role: 'user', content: `Instruktion: ${del.task}` }], 500);
          extractAndSaveMemory(agentKey, del.task, reply).catch(() => {});
          return { key: agentKey, name: agent.name, role: agent.role, reply };
        } catch(e) {
          return { key: agentKey, name: agent.name, role: agent.role, reply: 'Kunde inte svara just nu.' };
        }
      });
      const results = (await Promise.all(tasks)).filter(Boolean);
      agentResponses.push(...results);

      const mytimeResults = results.filter(r => ['alex','maya','lina','robin'].includes(r.key));
      if (mytimeResults.length > 0) {
        const summary = await callClaude(AGENTS.sam.system, [{
          role: 'user',
          content: `Sammanfatta dessa leveranser kort till Iris:\n${mytimeResults.map(r => `${r.name}: ${r.reply}`).join('\n')}`
        }], 300);
        agentResponses.push({ key: 'sam', name: 'Sam', role: 'Projektchef My-time', reply: summary, isSummary: true });
      }
    }

    // Detektera och skicka mejl automatiskt
    const emailDrafts = [];
    const sentEmails = [];

    for (const r of agentResponses) {
      if (detectEmailContent(r.reply)) {
        const parts = extractEmailParts(r.reply, null);
        // Rensa to-adressen från asterisker och mellanslag
      parts.to = (parts.to || '').replace(/[*]/g, '').trim();
      if (parts.to && parts.to.includes('@')) {
          try {
            await sendEmailSMTP(parts.to, parts.subject, parts.html, 'My-time');
            sentEmails.push({ agent: r.name, to: parts.to, subject: parts.subject });
            console.log(`Mejl skickat automatiskt till ${parts.to}`);
          } catch(e) {
            console.error('Auto-email error:', e.message);
            emailDrafts.push({ agent: r.name, ...parts, fullText: r.reply, error: e.message });
          }
        } else {
          emailDrafts.push({ agent: r.name, ...parts, fullText: r.reply });
        }
      }
    }

    res.json({ iris: irisReply, delegations, agents: agentResponses, emailDrafts, sentEmails });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Godkänn och skicka mejl
app.post('/api/approve-email', async (req, res) => {
  try {
    const { to, subject, html, fromName } = req.body;
    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'to, subject och html krävs' });
    }
    const result = await sendEmailSMTP(to, subject, html, fromName || 'Iris');
    console.log(`Mejl skickat till ${to}: ${subject}`);
    res.json({ success: true, result });
  } catch(e) {
    console.error('Approve email error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Skicka mejl
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, subject, body, fromName, preview } = req.body;

    if (preview) {
      const linaReply = await callClaude(AGENTS.lina.system, [{
        role: 'user',
        content: `Skriv ett personligt mejl till ${to} om: ${body}. Returnera BARA mejltexten som HTML, ingen förklaring.`
      }], 500);
      return res.json({ preview: linaReply, success: true });
    }

    const result = await sendEmailSMTP(to, subject, body, fromName);
    res.json({ success: true, result });
  } catch(e) {
    console.error('Email error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Testa mejl
app.post('/api/test-email', async (req, res) => {
  try {
    const { to } = req.body;
    const result = await sendEmailSMTP(
      to,
      'Test från Iris Command Center',
      '<h2>Hej!</h2><p>Detta är ett testmejl från Iris Command Center. Om du ser detta fungerar mejlintegrationen!</p><p>— Iris</p>',
      'Iris'
    );
    res.json({ success: true, result });
  } catch(e) {
    console.error('Test email error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Skapa nytt team
app.post('/api/create-team', async (req, res) => {
  try {
    const { projectName, description, parentPageId } = req.body;
    const teamPrompt = `Skapa ett komplett agentteam för projektet: "${projectName}". Beskrivning: "${description}".
Generera 5 agenter med unika korta antika namn.
Svara ENDAST med JSON:
{"team":[{"name":"...","role":"Projektchef","system":"..."},{"name":"...","role":"Dev","system":"..."},{"name":"...","role":"Strategi","system":"..."},{"name":"...","role":"Content","system":"..."},{"name":"...","role":"Tillväxt","system":"..."}]}`;

    const teamJson = await callClaude('Du är Iris. Svara ENDAST med valid JSON.', [{ role: 'user', content: teamPrompt }]);
    const clean = teamJson.replace(/```json|```/g, '').trim();
    const { team } = JSON.parse(clean);
    res.json({ team, success: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Fetch users (Playwright-förberedelse)
app.post('/api/fetch-users', async (req, res) => {
  try {
    const { url } = req.body;
    const alexReply = await callClaude(AGENTS.alex.system, [{
      role: 'user',
      content: `Du ska logga in på ${url} och hämta lista på företagsadmins. Beskriv exakt vilka steg du skulle ta.`
    }], 500);
    res.json({ success: true, alex: alexReply, note: 'Playwright-integration aktiveras i nästa steg' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Uppdatera Notion
app.post('/api/notion/update', async (req, res) => {
  try {
    const { pageId, content } = req.body;
    const response = await fetch(`${NOTION_URL}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({ children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content } }] } }] })
    });
    res.json({ success: true, data: await response.json() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// PLAYWRIGHT: Alex loggar in på My-time och hämtar data (via Browserless.io)
async function alexFetchMyTime() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.connectOverCDP(
    `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
  );
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('Alex: Loggar in på My-time...');
    await page.goto(process.env.MYTIME_URL || 'https://my-time.se/login');
    await page.waitForLoadState('networkidle');
    
    // Logga in
    const emailField = await page.$('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    const passField = await page.$('input[type="password"]');
    
    if (emailField && passField) {
      await emailField.fill(process.env.MYTIME_EMAIL || '');
      await passField.fill(process.env.MYTIME_PASSWORD || '');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      console.log('Alex: Inloggad!');
    }

    // Ta skärmdump
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
    
    // Hämta sidans text för analys
    const pageText = await page.evaluate(() => document.body.innerText);
    const pageUrl = page.url();
    const title = await page.title();

    // Hämta alla synliga siffror och statistik
    const stats = await page.evaluate(() => {
      const numbers = [];
      document.querySelectorAll('h1,h2,h3,p,span,div').forEach(el => {
        const text = el.innerText?.trim();
        if (text && /\d/.test(text) && text.length < 100) {
          numbers.push(text);
        }
      });
      return [...new Set(numbers)].slice(0, 30);
    });

    await browser.close();
    return { success: true, url: pageUrl, title, pageText: pageText.slice(0, 2000), stats, screenshot };
  } catch(e) {
    await browser.close();
    throw e;
  }
}

// ENDPOINT: Alex hämtar My-time data
app.post('/api/fetch-mytime', async (req, res) => {
  try {
    console.log('Alex: Startar My-time analys...');
    const data = await alexFetchMyTime();
    
    // Låt Alex analysera vad han ser
    const alexAnalysis = await callClaude(AGENTS.alex.system, [{
      role: 'user',
      content: `Du har loggat in på My-time. Här är vad du ser:
URL: ${data.url}
Titel: ${data.title}
Sidinnehåll: ${data.pageText}
Synlig statistik: ${data.stats.join(', ')}

Analysera: Hur många användare finns? Vad ser du för data? Vad behöver förbättras? Vilka är de viktigaste insikterna?`
    }], 800);

    // Låt Maya göra strategisk analys
    const mayaAnalysis = await callClaude(AGENTS.maya.system, [{
      role: 'user', 
      content: `Alex har hämtat data från My-time: ${alexAnalysis}. Gör en kort strategisk analys: konverteringsmöjligheter, prioriterade förbättringar för att nå första betalande kunden.`
    }], 500);

    // Sam sammanfattar
    const samSummary = await callClaude(AGENTS.sam.system, [{
      role: 'user',
      content: `Sammanfatta detta till Iris:
Alex: ${alexAnalysis}
Maya: ${mayaAnalysis}`
    }], 400);

    res.json({ 
      success: true, 
      screenshot: data.screenshot,
      alex: alexAnalysis, 
      maya: mayaAnalysis,
      sam: samSummary,
      rawData: { url: data.url, title: data.title, stats: data.stats }
    });
  } catch(e) {
    console.error('Playwright error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Alex söker prospekt online
app.post('/api/search-prospects', async (req, res) => {
  try {
    const { query } = req.body;
    const { chromium } = require('playwright-core');
    const browser = await chromium.connectOverCDP(
      `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query || 'småföretag tidsrapportering Sverige')}`);
    await page.waitForLoadState('networkidle');
    
    const results = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('h3').forEach(h => {
        const text = h.innerText?.trim();
        if (text && text.length > 5) items.push(text);
      });
      return items.slice(0, 10);
    });
    
    await browser.close();

    const robinAnalysis = await callClaude(AGENTS.robin.system, [{
      role: 'user',
      content: `Sökresultat för "${query}": ${results.join(', ')}. Analysera och ge konkreta förslag på prospekt och kanaler för My-time.`
    }], 500);

    res.json({ success: true, results, robin: robinAnalysis });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({
  status: 'Iris är online',
  agents: Object.keys(AGENTS).length,
  smtp: !!SMTP_USER,
  notion: !!NOTION_KEY
}));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Iris Command Center körs på port ${PORT}`));
server.timeout = 120000;
server.keepAliveTimeout = 120000;
