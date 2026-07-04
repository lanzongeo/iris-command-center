const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const https = require('https');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setTimeout(120000);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_KEY = process.env.NOTION_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const NOTION_URL = 'https://api.notion.com/v1';

// Agent systempromptar
const AGENTS = {
  iris: {
    name: 'Iris',
    role: 'Chief of Staff',
    system: `Du heter Iris och är Chief of Staff. Du koordinerar alla projekt och deras projektledare.
Personlighet: Skarp och direkt. Inga omvägar. Max 150 ord per svar.

Dina projektledare:
- Sam (My-time): Tidsrapporteringsapp för småteam, webb och mobil, MVP-fas
  Team: Alex (Dev), Maya (Strategi), Lina (Content), Robin (Tillväxt)
- Leo (Team2wear): Idrottsställ och kläder för motionslag, byggs med Lovable
  Team: Rex (Dev/Lovable), Cleo (Design), Nyx (Content), Cato (Tillväxt)
- Vera (ISO-plattformen): Digital plattform för ISO-revisionsberedskap
  Team: Ajax (Dev), Dion (Strategi), Lyra (Content), Zeno (Tillväxt)

När du delegerar använd format:
→ [AgentNamn]: [konkret uppgift]

Avsluta alltid med vad du behöver från grundaren.
Svara alltid på svenska.`
  },
  sam: {
    name: 'Sam', role: 'Projektchef My-time',
    system: `Du heter Sam och är projektchef för My-time, en tidsrapporteringsapp för småteam.
Team: Alex (Dev), Maya (Strategi), Lina (Content), Robin (Tillväxt).
Var konkret och kort. Max 80 ord. Svara på svenska.`
  },
  alex: {
    name: 'Alex', role: 'Dev · My-time',
    system: `Du är Alex, dev-agent för My-time. Fokus på kod, buggar och tekniska förbättringar. Max 80 ord. Svenska.`
  },
  maya: {
    name: 'Maya', role: 'Strategi · My-time',
    system: `Du är Maya, strategi-agent för My-time. Analyserar marknad, konkurrenter och positionering. Max 80 ord. Svenska.`
  },
  lina: {
    name: 'Lina', role: 'Content · My-time',
    system: `Du är Lina, content-agent för My-time. Skapar texter, mejl och innehåll. Leverera faktiskt innehåll. Max 80 ord. Svenska.`
  },
  robin: {
    name: 'Robin', role: 'Tillväxt · My-time',
    system: `Du är Robin, tillväxtagent för My-time. SEO, kanaler och konvertering. Max 80 ord. Svenska.`
  },
  leo: {
    name: 'Leo', role: 'Projektchef Team2wear',
    system: `Du heter Leo och är projektchef för Team2wear, idrottsställ för motionslag byggt med Lovable.
Team: Rex (Dev), Cleo (Design), Nyx (Content), Cato (Tillväxt). Max 80 ord. Svenska.`
  },
  rex: {
    name: 'Rex', role: 'Dev/Lovable · Team2wear',
    system: `Du är Rex, dev-agent för Team2wear. Du bygger och förbättrar sajten i Lovable. Ge exakta byggbeskrivningar. Max 80 ord. Svenska.`
  },
  cleo: {
    name: 'Cleo', role: 'Design · Team2wear',
    system: `Du är Cleo, designagent för Team2wear. Visuell identitet, produktpresentation och UX. Max 80 ord. Svenska.`
  },
  nyx: {
    name: 'Nyx', role: 'Content · Team2wear',
    system: `Du är Nyx, content-agent för Team2wear. Texter, sociala medier och kampanjer. Energisk och sportig ton. Max 80 ord. Svenska.`
  },
  cato: {
    name: 'Cato', role: 'Tillväxt · Team2wear',
    system: `Du är Cato, tillväxtagent för Team2wear. Hitta motionslag, konvertering och kanaler. Max 80 ord. Svenska.`
  },
  vera: {
    name: 'Vera', role: 'Projektchef ISO-plattformen',
    system: `Du heter Vera och är projektchef för ISO-plattformen, en SaaS för löpande ISO-revisionsberedskap.
Team: Ajax (Dev), Dion (Strategi), Lyra (Content), Zeno (Tillväxt). Max 80 ord. Svenska.`
  },
  ajax: {
    name: 'Ajax', role: 'Dev · ISO-plattformen',
    system: `Du är Ajax, dev-agent för ISO-plattformen. Dokumenthantering, avvikelser och årshjul. Säkerhet prioritet. Max 80 ord. Svenska.`
  },
  dion: {
    name: 'Dion', role: 'Strategi · ISO-plattformen',
    system: `Du är Dion, strategi-agent för ISO-plattformen. Pilotkunder, positionering och B2B go-to-market. Max 80 ord. Svenska.`
  },
  lyra: {
    name: 'Lyra', role: 'Content · ISO-plattformen',
    system: `Du är Lyra, content-agent för ISO-plattformen. Guider, whitepapers och kommunikation till kvalitetschefer. Max 80 ord. Svenska.`
  },
  zeno: {
    name: 'Zeno', role: 'Tillväxt · ISO-plattformen',
    system: `Du är Zeno, tillväxtagent för ISO-plattformen. LinkedIn, partnerships och content marketing mot ISO-företag. Max 80 ord. Svenska.`
  }
};

// Anropa Claude API
async function callClaude(system, messages, maxTokens = 1000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
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

// Parsea delegationer från Iris svar
function parseDelegations(text) {
  const lines = text.split('\n');
  const dels = [];
  for (const line of lines) {
    const m = line.match(/→\s*(\w+):\s*(.+)/);
    if (m) dels.push({ agent: m[1].toLowerCase(), task: m[2].trim() });
  }
  return dels;
}

// Hitta rätt agent
function findAgent(name) {
  return Object.keys(AGENTS).find(k =>
    k === name.toLowerCase() ||
    AGENTS[k].name.toLowerCase() === name.toLowerCase()
  );
}

// ENDPOINT: Chatta med Iris (eller custom chief)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system } = req.body;
    const activeSystem = system || AGENTS.iris.system;
    const irisReply = await callClaude(activeSystem, messages);
    const delegations = parseDelegations(irisReply);

    const agentResponses = [];

    if (delegations.length > 0) {
      // Kör delegationer parallellt
      const tasks = delegations.map(async (del) => {
        const agentKey = findAgent(del.agent);
        if (!agentKey) return null;
        const agent = AGENTS[agentKey];
        try {
          const reply = await callClaude(agent.system, [
            { role: 'user', content: `Instruktion: ${del.task}` }
          ], 500);
          return { key: agentKey, name: agent.name, role: agent.role, reply };
        } catch (e) {
          return { key: agentKey, name: agent.name, role: agent.role, reply: 'Kunde inte svara just nu.' };
        }
      });

      const results = (await Promise.all(tasks)).filter(Boolean);
      agentResponses.push(...results);

      // Sam sammanfattar om My-time-agenter svarat
      const mytimeResults = results.filter(r => ['alex','maya','lina','robin'].includes(r.key));
      if (mytimeResults.length > 0) {
        const summary = await callClaude(AGENTS.sam.system, [{
          role: 'user',
          content: `Sammanfatta dessa leveranser kort till Iris:\n${mytimeResults.map(r => `${r.name}: ${r.reply}`).join('\n')}`
        }], 300);
        agentResponses.push({ key: 'sam', name: 'Sam', role: 'Projektchef My-time', reply: summary, isSummary: true });
      }
    }

    res.json({ iris: irisReply, delegations, agents: agentResponses });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Skapa nytt team i Notion
app.post('/api/create-team', async (req, res) => {
  try {
    const { projectName, description, parentPageId } = req.body;

    // Iris genererar teamet
    const teamPrompt = `Skapa ett komplett agentteam för projektet: "${projectName}". Beskrivning: "${description}".

Generera:
1. Projektledarens namn (kort, antikt)
2. 4 agentnamn (kort, antika, unika)
3. Deras roller (Projektchef, Dev, Strategi, Content, Tillväxt)
4. Systemprompt för varje agent (max 50 ord per agent)

Svara ENDAST med JSON i detta format:
{
  "team": [
    {"name": "...", "role": "Projektchef", "system": "..."},
    {"name": "...", "role": "Dev", "system": "..."},
    {"name": "...", "role": "Strategi", "system": "..."},
    {"name": "...", "role": "Content", "system": "..."},
    {"name": "...", "role": "Tillväxt", "system": "..."}
  ]
}`;

    const teamJson = await callClaude(
      'Du är Iris, Chief of Staff. Svara ENDAST med valid JSON, inga kommentarer.',
      [{ role: 'user', content: teamPrompt }]
    );

    const clean = teamJson.replace(/```json|```/g, '').trim();
    const { team } = JSON.parse(clean);

    // Skapa Notion-sida om parentPageId finns
    if (NOTION_KEY && parentPageId) {
      const notionPage = await fetch(`${NOTION_URL}/pages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_KEY}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { page_id: parentPageId },
          properties: {
            title: { title: [{ text: { content: `📁 ${projectName}` } }] }
          },
          children: [
            {
              object: 'block', type: 'heading_1',
              heading_1: { rich_text: [{ text: { content: projectName } }] }
            },
            {
              object: 'block', type: 'paragraph',
              paragraph: { rich_text: [{ text: { content: description } }] }
            },
            {
              object: 'block', type: 'heading_2',
              heading_2: { rich_text: [{ text: { content: '👥 Team' } }] }
            },
            ...team.map(a => ({
              object: 'block', type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [{ text: { content: `${a.name} — ${a.role}` } }]
              }
            }))
          ]
        })
      });
      const notionData = await notionPage.json();
      res.json({ team, notionPageId: notionData.id, success: true });
    } else {
      res.json({ team, success: true });
    }

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ENDPOINT: Uppdatera Notion-sida
app.post('/api/notion/update', async (req, res) => {
  try {
    const { pageId, content } = req.body;
    const response = await fetch(`${NOTION_URL}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        children: [{
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ text: { content } }] }
        }]
      })
    });
    const data = await response.json();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hälsocheck
app.get('/health', (req, res) => res.json({ status: 'Iris är online', agents: Object.keys(AGENTS).length }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Iris Command Center körs på port ${PORT}`));
server.timeout = 120000;
server.keepAliveTimeout = 120000;
