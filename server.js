const nodemailer = require('nodemailer');
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

// Agent systempromptar
const AGENTS = {
  iris: {
    name: 'Iris', role: 'Chief of Staff',
    system: `Du heter Iris och är Chief of Staff. Du koordinerar alla projekt och deras projektledare.
Personlighet: Skarp och direkt. Inga omvägar. Max 150 ord per svar.
Projekt: My-time (Sam+team), Team2wear (Leo+team), ISO-plattformen (Vera+team).
När du delegerar: → [AgentNamn]: [uppgift]
Svara på svenska.`
  },
  sam: { name: 'Sam', role: 'Projektchef My-time', system: `Du heter Sam och är projektchef för My-time, en tidsrapporteringsapp för småteam. Team: Alex (Dev), Maya (Strategi), Lina (Content), Robin (Tillväxt). Max 80 ord. Svenska.` },
  alex: { name: 'Alex', role: 'Dev · My-time', system: `Du är Alex, dev-agent för My-time. Fokus på kod, buggar och tekniska förbättringar. Max 80 ord. Svenska.` },
  maya: { name: 'Maya', role: 'Strategi · My-time', system: `Du är Maya, strategi-agent för My-time. Analyserar marknad, konkurrenter och positionering. Max 80 ord. Svenska.` },
  lina: { name: 'Lina', role: 'Content · My-time', system: `Du är Lina, content-agent för My-time. Skapar texter och mejl. Leverera faktiskt innehåll. Max 80 ord. Svenska.` },
  robin: { name: 'Robin', role: 'Tillväxt · My-time', system: `Du är Robin, tillväxtagent för My-time. SEO, kanaler och konvertering. Max 80 ord. Svenska.` },
  leo: { name: 'Leo', role: 'Projektchef Team2wear', system: `Du heter Leo och är projektchef för Team2wear, idrottsställ för motionslag byggt med Lovable. Team: Rex (Dev), Cleo (Design), Nyx (Content), Cato (Tillväxt). Max 80 ord. Svenska.` },
  rex: { name: 'Rex', role: 'Dev/Lovable · Team2wear', system: `Du är Rex, dev-agent för Team2wear. Du bygger sajten i Lovable. Ge exakta byggbeskrivningar. Max 80 ord. Svenska.` },
  cleo: { name: 'Cleo', role: 'Design · Team2wear', system: `Du är Cleo, designagent för Team2wear. Visuell identitet och UX. Max 80 ord. Svenska.` },
  nyx: { name: 'Nyx', role: 'Content · Team2wear', system: `Du är Nyx, content-agent för Team2wear. Texter och sociala medier. Energisk ton. Max 80 ord. Svenska.` },
  cato: { name: 'Cato', role: 'Tillväxt · Team2wear', system: `Du är Cato, tillväxtagent för Team2wear. Motionslag, konvertering och kanaler. Max 80 ord. Svenska.` },
  vera: { name: 'Vera', role: 'Projektchef ISO-plattformen', system: `Du heter Vera och är projektchef för ISO-plattformen, SaaS för ISO-revisionsberedskap. Team: Ajax (Dev), Dion (Strategi), Lyra (Content), Zeno (Tillväxt). Max 80 ord. Svenska.` },
  ajax: { name: 'Ajax', role: 'Dev · ISO-plattformen', system: `Du är Ajax, dev-agent för ISO-plattformen. Dokumenthantering och avvikelser. Max 80 ord. Svenska.` },
  dion: { name: 'Dion', role: 'Strategi · ISO-plattformen', system: `Du är Dion, strategi-agent för ISO-plattformen. Pilotkunder och B2B. Max 80 ord. Svenska.` },
  lyra: { name: 'Lyra', role: 'Content · ISO-plattformen', system: `Du är Lyra, content-agent för ISO-plattformen. Guider och kommunikation till kvalitetschefer. Max 80 ord. Svenska.` },
  zeno: { name: 'Zeno', role: 'Tillväxt · ISO-plattformen', system: `Du är Zeno, tillväxtagent för ISO-plattformen. LinkedIn och partnerships. Max 80 ord. Svenska.` }
};

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
  const emailSignals = ['till:', 'från:', 'ämne:', 'hej!', 'med vänliga hälsningar', 'subject:', 'dear', 'välkommen'];
  const lower = text.toLowerCase();
  return emailSignals.some(signal => lower.includes(signal));
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
    const activeSystem = system || AGENTS.iris.system;
    const irisReply = await callClaude(activeSystem, messages);
    const delegations = parseDelegations(irisReply);
    const agentResponses = [];

    if (delegations.length > 0) {
      const tasks = delegations.map(async (del) => {
        const agentKey = findAgent(del.agent);
        if (!agentKey) return null;
        const agent = AGENTS[agentKey];
        try {
          const reply = await callClaude(agent.system, [{ role: 'user', content: `Instruktion: ${del.task}` }], 500);
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
