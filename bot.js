import { Client, GatewayIntentBits } from 'discord.js';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;

const QUESTIONS = [
  "Let's start with the basics. What's your full name?",
  "What's your date of birth?",
  "What is your email address?",
  "What is your phone number?",
  "Do you have a Linkedin Profile? Share your Linkedin ID URL",
  "Which city are you currently living in?",
  "This role is based in-office in Delhi. Are you open to relocating? Please be honest — it genuinely helps us plan better.",
  "What is your latest educational qualification?",
  "Is your education currently ongoing or completed?",
  "What was your last score or percentage in your most recent academic program?",
  "Please walk me through your work history in detail — total years of experience, domains, and what you actually did in each role.",
  "Have you ever started a venture or tried to run your own business? If yes, tell me what it was, what scale you reached, and why you stopped. If no, that's fine — just say so.",
  "What are your long term goals? Walk me through what you want to achieve in 1 year, 3 years, 5 years, and 10 years.",
  "How deeply do you use AI in your day to day life and work? Which tools are you hands-on with? Have you experimented with AI Agents or Agent Orchestration?",
  "What is the highest number of hours you have put in continuously to complete something — in work, studies, or anything else? What was it and what drove you?",
  "What hard skills do you have that could help Stirring Minds immediately? Rate yourself honestly on each.",
  "How good are you at convincing people? Rate yourself out of 10 and back it up with real examples.",
  "What are the core values you live by that you genuinely won't compromise on?",
  "Could you commit wholeheartedly to working full time with an early stage startup for the next 3 years in a high intensity environment? What would you be leaving behind?",
  "If you contribute meaningfully, there is a possibility of a Founding Team Member role and equity. With that on the table — if asked to work without pay for the first month as a trial, would you still want to work with us? Tell me honestly and why.",
  "The compensation is INR 15,000 to 30,000 per month plus bonuses. Does that work for you? Where do you see yourself on that range?",
  "How soon can you join if offered this role?"
];

const state = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

async function callAI(messages) {
  const response = await fetch(
    `https://gateway.ai.cloudflare.com/v1/d2ab95608d255a1cbfac7fc59c557989/mahesh-flashspace/workers-ai/@cf/moonshotai/kimi-k2.6`,
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
  return data.result?.response || data.result?.choices?.[0]?.message?.content || data.choices?.[0]?.message?.content || "";
}

async function saveToClickUp(candidateName, answers) {
  const content = answers.map((a, i) => `Q${i + 1}: ${QUESTIONS[i] || 'Follow-up'}\nA: ${a}`).join("\n\n");

  const email = answers[2] || "";
  const phone = answers[3] || "";
  const linkedin = answers[4] || "";
  const ventureAnswer = answers[11] || "";

  try {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`, {
      method: "POST",
      headers: {
        "Authorization": CLICKUP_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: `Interview — ${candidateName}`,
        description: content,
        status: "to do",
        custom_fields: [
          {
            id: "2104e524-598d-4970-91e6-ee7490e0922c",
            value: email
          },
          {
            id: "95818473-a6f4-40a2-b976-ee98014d16eb",
            value: phone
          },
          {
            id: "32634985-e24c-46cd-8a96-9a08ac493406",
            value: linkedin
          },
          {
            id: "71ed4b05-7086-41a1-94ac-50ac2983686b",
            value: ventureAnswer
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("ClickUp API error:", JSON.stringify(data));
    } else {
      console.log("ClickUp task created successfully for:", candidateName);
    }
  } catch (error) {
    console.error("saveToClickUp failed:", error.message);
  }
}
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  console.log(`Message received: ${message.content} in channel ${message.channel.id} from ${message.author.tag}`);

  const channelId = message.channel.id;
  const content = message.content.trim();

  if (!state[channelId]) return;

  const s = state[channelId];

  s.answers.push(content);

  if (s.step === 0) {
    s.candidateName = content.split(" ")[0];
  }

  // Probing for venture question (step 11)
  if (s.step === 11 && s.probingCount < 2) {
    const ventureKeywords = ["started", "venture", "business", "startup", "founded", "ran", "built", "launched"];
    const hasVenture = ventureKeywords.some(k => content.toLowerCase().includes(k));
    if (hasVenture && content.length > 80) {
      s.probingCount++;
      const typingInterval1 = setInterval(() => {
        message.channel.sendTyping();
      }, 5000);
      const probe = await callAI([
        { role: "system", content: "You are a warm but sharp interviewer at Stirring Minds startup in Delhi. Ask ONE probing follow-up question to verify the candidate's venture experience. Be specific — ask for numbers, what they personally did, real obstacles. Max 2 sentences." },
        { role: "user", content: `Candidate said: "${content}". Generate one follow-up question.` }
      ]);
      clearInterval(typingInterval1);
      if (probe && probe.trim()) await message.channel.send(probe);
      return;
    }
  }

  // Probing for skills question (step 15)
  if (s.step === 15 && s.probingCount < 2) {
    s.probingCount++;
    const typingInterval2 = setInterval(() => {
      message.channel.sendTyping();
    }, 5000);
    const probe = await callAI([
      { role: "system", content: "You are a warm but sharp interviewer at Stirring Minds startup in Delhi. The candidate just listed their hard skills. Pick the most interesting skill and ask ONE specific follow-up. Ask for real examples or results. Max 2 sentences." },
      { role: "user", content: `Candidate's skills: "${content}". Generate one follow-up question.` }
    ]);
    clearInterval(typingInterval2);
    if (probe && probe.trim()) await message.channel.send(probe);
    return;
  }

  s.probingCount = 0;
  s.step++;

  if (s.step >= QUESTIONS.length) {
    delete state[channelId];
    await saveToClickUp(s.candidateName, s.answers);
    await message.channel.send(`Thank you for taking the time to go through this, ${s.candidateName}. Your responses have been recorded and our team will review them carefully.\n\nIf you are shortlisted for the next round, you will hear from us within 3–5 working days via email or Discord.\n\nWishing you all the best.`);
    return;
  }

  const isLastQuestion = s.step === QUESTIONS.length - 1;
  const nextQuestion = QUESTIONS[s.step];
  const typingInterval3 = setInterval(() => {
    message.channel.sendTyping();
  }, 5000);
  const humanResponse = await callAI([
    {
      role: "system",
      content: `You are Priya, a warm, sharp and professional interviewer at Stirring Minds — a startup ecosystem in Delhi. You are conducting an interview for the AI Generalist role.

Your job is to:
1. Briefly acknowledge the candidate's previous answer in 1 sentence — be genuine, not generic. If the answer was vague or short, you can gently note that.
2. Then naturally transition into asking the next question.

Rules:
- Never use emojis
- Never say "Great answer!" or "Wonderful!" — be real, not flattering
- Keep acknowledgement to 1 sentence maximum
- The next question must be asked exactly as provided — do not rephrase it
- Total response should be 2-4 sentences maximum
- Be warm but professional — like a real interviewer who actually read the answer
- CRITICAL: This is question ${s.step + 1} of ${QUESTIONS.length}. ${isLastQuestion ? "This is the FINAL question of the interview. Ask it and stop completely. Do NOT add any closing remarks, follow-up questions, or anything after it. Just acknowledge and ask the final question. Nothing else." : ""}`
    },
    {
      role: "user",
      content: `Candidate just answered: "${content}"

Now acknowledge their answer and ask this next question exactly: "${nextQuestion}"`
    }
  ]);
  clearInterval(typingInterval3);
  if (humanResponse && humanResponse.trim()) {
    await message.channel.send(humanResponse);
  } else {
    await message.channel.send(nextQuestion);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'start') return;

  const channelId = interaction.channelId;

  state[channelId] = { step: 0, answers: [], probingCount: 0, candidateName: "" };

  await interaction.reply({ content: "Starting your interview now...", ephemeral: true });

  await interaction.channel.send(`Hi there! Welcome to the Stirring Minds interview process for the **AI Generalist** role.\n\nI'm your AI interviewer today. This is a conversational interview — I'll ask you questions one at a time, and I'd love for you to answer each one thoughtfully and honestly.\n\nA few things before we begin:\n— Take your time with each answer. Quality matters more than speed.\n— Be specific and real. Generic answers won't help you stand out.\n— There are no trick questions. We want to understand who you truly are.\n\nThis interview has 3 sections and will take approximately 25–35 minutes.`);

  await interaction.channel.send(QUESTIONS[0]);
});

client.login(DISCORD_BOT_TOKEN);
