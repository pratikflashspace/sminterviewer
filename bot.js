const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;

import { subtle } from 'node:crypto';

async function verify(request, publicKey) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!signature || !timestamp) return false;
  const body = await request.clone().text();
  const key = await subtle.importKey(
    'raw',
    hexToBuffer(publicKey),
    { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
    false,
    ['verify']
  );
  return subtle.verify(
    'NODE-ED25519',
    key,
    hexToBuffer(signature),
    new TextEncoder().encode(timestamp + body)
  );
}

function hexToBuffer(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}

const QUESTIONS = [
  "Let's start with the basics. What's your full name?",
  "Nice to meet you! What's your date of birth?",
  "Which city are you currently living in?",
  "This role is based in-office in Delhi. Are you open to relocating if you aren't based there already? Please be honest — it genuinely helps us plan better.",
  "What is your latest educational qualification?",
  "Is your education currently ongoing or completed?",
  "What was your last score or percentage in your most recent academic program?",
  "Now let's talk about your experience. Please walk me through your work history in detail — total years of experience, the domains you've worked in, and a solid description of what you actually did in each role. Take your time — the more detail the better.",
  "Have you ever started a venture or tried to run your own business — even something small? If yes, tell me what it was, what scale you reached, and why you stopped. If no, that's completely fine — just say so.",
  "Big picture — what are your long term goals? Walk me through what you want to achieve in the next 1 year, 3 years, 5 years, and 10 years. Be specific.",
  "AI is at the core of this role. How deeply do you use AI in your day to day life and work? Which tools are you hands-on with? And have you ever experimented with AI Agents or Agent Orchestration? Tell me everything.",
  "Tell me about a time you went all in on something. What is the highest number of hours you have put in continuously to complete something — in work, studies, or anything else? What was it, and what drove you to push that hard?",
  "What hard skills do you have that could help Stirring Minds immediately? Think along the lines of Software Development, Graphic Design, Video Editing, Performance Marketing, Content Creation, Systems Planning, Project Management, or anything else you're genuinely strong at. List them and give me an honest self-assessment of each.",
  "How good are you at convincing people? Rate yourself honestly out of 10 — and back it up with a real example or two where your ability to convince someone made a difference.",
  "What are the core values you live by — the ones you genuinely won't compromise on, no matter what? Tell me what they are and why they matter to you.",
  "If given the opportunity to work full time with an early stage startup — be part of the core team, contribute to building something real, operate in a high intensity environment where the line between work and life blurs — could you commit to that wholeheartedly for the next 3 years? What would you be leaving behind? And do you genuinely believe you're built for that kind of journey?",
  "Taking that a step further — if you are someone who contributes meaningfully and helps build this, there is a real possibility of being given a Founding Team Member role and equity in the long term success of the venture. With all of that on the table — if you were asked to work without pay for the first month as a trial of commitment and fit, would you still want to work with us? Tell me honestly, and tell me why.",
  "The compensation for this role is between INR 15,000 to INR 30,000 per month, plus bonuses and incentives based on performance. Does that work for you? And where do you see yourself on that range based on what you bring to the table?",
  "Last one — how soon can you join if you are offered this role?"
];

const state = {};

async function sendDiscordMessage(channelId, content) {
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });
}

async function callAI(messages) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_AI_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messages })
    }
  );
  const data = await response.json();
  return data.result?.response || "";
}

async function saveToClickUp(candidateName, answers) {
  const content = answers.map((a, i) => `Q${i + 1}: ${QUESTIONS[i] || 'Follow-up'}\nA: ${a}`).join("\n\n");
  await fetch(`https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`, {
    method: "POST",
    headers: {
      "Authorization": CLICKUP_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `Interview — ${candidateName}`,
      description: content,
      status: "to do"
    })
  });
}

async function handleAnswer(channelId, content) {
  if (!state[channelId]) return;
  const s = state[channelId];

  s.answers.push(content);

  if (s.step === 0) {
    s.candidateName = content.split(" ")[0];
  }

  // Probing for venture question (step 8)
  if (s.step === 8 && s.probingCount < 2) {
    const ventureKeywords = ["started", "venture", "business", "startup", "founded", "ran", "built", "launched"];
    const hasVenture = ventureKeywords.some(k => content.toLowerCase().includes(k));
    if (hasVenture && content.length > 80) {
      s.probingCount++;
      const probe = await callAI([
        { role: "system", content: "You are a warm but sharp interviewer at Stirring Minds startup in Delhi. Ask ONE probing follow-up question to verify the candidate's venture experience. Be specific — ask for numbers, what they personally did, real obstacles. Max 2 sentences." },
        { role: "user", content: `Candidate said: "${content}". Generate one follow-up question.` }
      ]);
      await sendDiscordMessage(channelId, probe);
      return;
    }
  }

  // Probing for skills question (step 12)
  if (s.step === 12 && s.probingCount < 2) {
    s.probingCount++;
    const probe = await callAI([
      { role: "system", content: "You are a warm but sharp interviewer at Stirring Minds startup in Delhi. The candidate just listed their hard skills. Pick the most interesting skill and ask ONE specific follow-up. Ask for real examples or results. Max 2 sentences." },
      { role: "user", content: `Candidate's skills: "${content}". Generate one follow-up question.` }
    ]);
    await sendDiscordMessage(channelId, probe);
    return;
  }

  s.probingCount = 0;
  s.step++;

  if (s.step >= QUESTIONS.length) {
    await saveToClickUp(s.candidateName, s.answers);
    await sendDiscordMessage(channelId, `Thank you for taking the time to go through this, ${s.candidateName}. Your responses have been recorded and our team will review them carefully.\n\nIf you are shortlisted for the next round, you will hear from us within 3–5 working days via email or Discord.\n\nWishing you all the best.`);
    delete state[channelId];
    return;
  }

  await sendDiscordMessage(channelId, QUESTIONS[s.step]);
}

export default {
  async fetch(request, env) {
    const PUBLIC_KEY = env.DISCORD_PUBLIC_KEY;

    if (request.method !== "POST") return new Response("ok");

    const isValid = await verify(request, PUBLIC_KEY);
    if (!isValid) return new Response("Invalid signature", { status: 401 });

    const body = await request.json();

    // Discord PING
    if (body.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Slash command /start
 if (body.type === 2 && body.data.name === "start") {
  const channelId = body.channel_id;

  state[channelId] = { step: 0, answers: [], probingCount: 0, candidateName: "" };

  await sendDiscordMessage(channelId, `Hi there! Welcome to the Stirring Minds interview process for the **AI Generalist** role.\n\nI'm your AI interviewer today. This is a conversational interview — I'll ask you questions one at a time, and I'd love for you to answer each one thoughtfully and honestly.\n\nA few things before we begin:\n— Take your time with each answer. Quality matters more than speed.\n— Be specific and real. Generic answers won't help you stand out.\n— There are no trick questions. We want to understand who you truly are.\n\nThis interview has 3 sections and will take approximately 25–35 minutes.`);

  await sendDiscordMessage(channelId, QUESTIONS[0]);

  return new Response(
    JSON.stringify({ type: 4, data: { content: "Starting your interview now...", flags: 64 } }),
    { headers: { "Content-Type": "application/json" } }
  );
}
    // Message component interaction (for follow-up answers)
    if (body.type === 3) {
      const channelId = body.channel_id;
      const content = body.data?.values?.[0] || "";
      await handleAnswer(channelId, content);
      return new Response(JSON.stringify({ type: 6 }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("ok");
  }
};