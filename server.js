const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const osc = require("osc");
const { DatabaseSync } = require("node:sqlite");

let PORT = Number.parseInt(process.env.PORT || "3000", 10);
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) PORT = 3000;
const MODERATION_WORDS_PATH = path.join(__dirname, "moderation", "bad-words.txt");
const MODERATION_JSON_PATH = path.join(__dirname, "moderation", "blocked-words.json");
const MODERATION_TEXT_DEFAULT = "# Een woord per regel. Lege regels en regels met # worden genegeerd.\n";
const BRAINROT_PATH = path.join(__dirname, "brainrot.txt");
const BRAINROT_TEXT_DEFAULT = "# Een woord/term per regel voor bot-reacties.\n";
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "live.sqlite");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_RESTART_BOOT_DELAY_MS = clampInt(process.env.ADMIN_RESTART_BOOT_DELAY_MS || "0", 0, 10000, 0);
const ADMIN_RESTART_CHILD_BOOT_DELAY_MS = clampInt(
  process.env.ADMIN_RESTART_CHILD_BOOT_DELAY_MS || "900",
  200,
  10000,
  900
);
const ADMIN_TRUSTED_DEVICE_COOKIE = "admin_device";
const ADMIN_TRUSTED_DEVICE_TTL_DAYS = clampInt(
  process.env.ADMIN_TRUSTED_DEVICE_TTL_DAYS || "60",
  1,
  365,
  60
);
const ADMIN_TRUSTED_DEVICE_TTL_MS = ADMIN_TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000;
const ADMIN_TRUSTED_SELECTOR_BYTES = 12;
const ADMIN_TRUSTED_SECRET_BYTES = 32;
const DEFAULT_POLL_DURATION_SECONDS = clampInt(process.env.POLL_DURATION_SECONDS || "60", 5, 3600, 60);
let currentPollDurationSeconds = DEFAULT_POLL_DURATION_SECONDS;
const SIM_DEFAULTS = {
  clients: 50,
  durationSec: 0,
  msgRate: 0.03,
  reactionRate: 0.35,
  emojiInlineRate: 0.18,
  emojiLooseRate: 0.7,
  spawnMs: 80,
  minGapMs: 2300,
  autoVote: true,
  pollVoteChance: 0.9,
  voteDelayMinMs: 400,
  voteDelayMaxMs: 3200,
  namePrefix: "SimUser",
  topic: "",
  positive: 0.45,
  negative: 0.7,
  callbackRate: 0.34,
};
const SIM_DEFAULTS_SETTING_KEY = "sim_defaults_json";
const SIM_PERSONAS = [
  {
    id: "deadpan_critic",
    weight: 30,
    openers: [
      "Korte audit",
      "Eerlijke update",
      "Feitelijke observatie",
      "Snelle reality-check",
      "Zonder filter",
    ],
    setups: [
      "de energie is aanwezig",
      "de intentie is goud waard",
      "het plan klinkt dapper",
      "de vibe doet goed haar best",
      "dit idee heeft potentie",
    ],
    twists: [
      "maar de uitvoering staat nog in de file",
      "maar de details spelen nog verstoppertje",
      "maar het ritme heeft pauze aangevraagd",
      "maar finesse komt met de volgende bus",
      "maar de timing onderhandelt nog met de realiteit",
    ],
    closers: [
      "Ik klap voorzichtig.",
      "Dit noem ik gecontroleerde chaos.",
      "We zitten in de pre-finale fase.",
      "Toch respect voor de durf.",
    ],
    quickHits: [
      "Sterke poging met theatrale bijwerkingen.",
      "Ik heb vragen, maar wel met applaus.",
      "Prima chaos, netjes verpakt.",
      "Dit voelt als plannen met adrenaline.",
    ],
  },
  {
    id: "snarky_hype",
    weight: 26,
    openers: [
      "Breaking",
      "Hot take",
      "Publieke dienstmededeling",
      "Laatste nieuws vanaf rij 1",
      "Mini-rapport",
    ],
    setups: [
      "dit gaat hard",
      "de ambitie is indrukwekkend",
      "deze ronde heeft lef",
      "de intensiteit is hoog",
      "de inzet is boven verwachting",
    ],
    twists: [
      "maar logica is op stille modus gezet",
      "en subtiliteit heeft vandaag vrij genomen",
      "terwijl consistentie nog aan het parkeren is",
      "maar de afwerking leeft van improvisatie",
      "en precisie is nu meer een suggestie",
    ],
    closers: [
      "10/10 voor inzet, 7/10 voor zwaartekracht.",
      "Ik steun dit met lichte scepsis.",
      "Dit is scherp op een avontuurlijke manier.",
      "Perfect? Nee. Vermakelijk? Absoluut.",
    ],
    quickHits: [
      "Dit is precies het soort chaos waar ik voor blijf.",
      "Ik voel vertrouwen en kleine paniek tegelijk.",
      "Cynisch gezien: verrassend sterk.",
      "Dit plan heeft karakter en rooksporen.",
    ],
  },
  {
    id: "absurd_analyst",
    weight: 22,
    openers: [
      "Statistisch gezien",
      "In theorie",
      "Wetenschappelijk-ish",
      "Uit mijn zeer objectieve meting",
      "Volgens de grafiek in mijn hoofd",
    ],
    setups: [
      "dit werkt beter dan verwacht",
      "de lijn gaat omhoog-ish",
      "de flow is onverwacht stabiel",
      "dit tempo is gevaarlijk competent",
      "de focus piekt op charmante momenten",
    ],
    twists: [
      "alsof een blender de planning doet",
      "met de energie van drie espresso en een deadline",
      "terwijl elke slide een eigen plot-twist heeft",
      "alsof chaos nu een officieel feature is",
      "met exact nul rem en veel bravoure",
    ],
    closers: [
      "Mijn spreadsheet huilt, maar ik geniet.",
      "Dit is elegant op een wilde dinsdag-manier.",
      "Controle is relatief, entertainment niet.",
      "Ik kan dit niet uitleggen, wel waarderen.",
    ],
    quickHits: [
      "Als dit een roadmap is, wil ik de directors cut.",
      "Ik noem dit professioneel improviseren.",
      "Verontrustend strak, en dat bedoel ik positief.",
      "Dit voelt als strategie met confetti.",
    ],
  },
  {
    id: "friendly_roaster",
    weight: 22,
    openers: [
      "Met liefde gezegd",
      "Heel zachtjes cynisch",
      "Respectvol gemeen",
      "Met warme sarcasme",
      "Compliment met bijsluiter",
    ],
    setups: [
      "jullie doen het goed",
      "de basis staat stevig",
      "de spirit is top",
      "dit landt beter dan gedacht",
      "de intentie is verrassend scherp",
    ],
    twists: [
      "maar de afwerking knipoogt nog naar het lot",
      "alleen het einde zoekt nog een routeplanner",
      "alleen de timing ademt pure jazz",
      "maar details houden van dramatische entree",
      "terwijl structuur zich schuilhoudt achter decor",
    ],
    closers: [
      "Ik meen dit onironisch, grotendeels.",
      "Nog een ronde en dit wordt verdacht goed.",
      "Scherp, rommelig, heerlijk.",
      "Ik ben kritisch en toch fan.",
    ],
    quickHits: [
      "Dit is slim met een kleine bocht.",
      "Ik wil mopperen, maar jullie maken het lastig.",
      "Cynisch oordeel: opvallend geslaagd.",
      "Deze chaos heeft betere manieren dan gemiddeld.",
    ],
  },
];
const SIM_ABSURD_FRAGMENTS = [
  "mijn brein reboot net",
  "wat gebeurt hier precies",
  "ik ga stuk",
  "dit is pure chaos",
  "ik ben kwijt maar ik lach",
  "dit had ik niet op mijn bingokaart",
  "niemand was hier klaar voor",
  "dit is illegaal grappig",
  "deze timing is absurd goed",
  "ik tril van het lachen",
  "dit ontspoort op de beste manier",
  "ik was mentaal al afgemeld",
  "wat een premium puinhoop",
  "mijn focus is weg maar mijn lol niet",
  "dit is theater met schade",
  "ik kan dit niet uitleggen aan HR",
  "dit voelde als een jumpscare",
  "deze bocht was niet aangekondigd",
  "dit ging van 0 naar chaos",
  "mijn algoritme snapt dit niet",
  "ik wil dit frame voor frame terugzien",
  "dit was onnodig grappig",
  "ik hoor de violen van drama al",
  "deze edit is gewoon geweld",
];
const SIM_TOPIC_TEMPLATES = [
  "{topic} had niemand op bingokaart.",
  "{topic} ging ineens heel hard.",
  "{topic} was onnodig goed.",
  "{topic} geeft main character stress.",
  "{topic} is stiekem mijn favoriet.",
  "{topic} voelde als een plot twist.",
  "{topic} was een nette klap in mijn planning.",
  "voor {topic} blijf ik wakker.",
  "{topic} had betere timing dan ik vandaag.",
  "{topic} was chaos met discipline.",
  "{topic} is precies waarom ik bleef kijken.",
  "{topic} was kort maar dodelijk raak.",
  "{topic} voelt als premium internet.",
  "{topic} was geen segment, dat was een gebeurtenis.",
];
const SIM_TOPIC_FOLLOWUPS = [
  "meer {topic} graag.",
  "{topic} was raak.",
  "{topic} stuur ik door.",
  "dat stukje over {topic} pakte me.",
  "{topic} was stiekem het hoogtepunt.",
  "bij {topic} ben ik afgehaakt van de realiteit.",
  "{topic} had de zaal meteen vast.",
  "{topic} klinkt als sequel-materiaal.",
  "{topic} mag terugkomen.",
  "{topic} was een directe replay.",
  "{topic} was kort en precies goed.",
  "{topic} voelde als inside joke level 9000.",
  "voor {topic} had ik nog een uur gezeten.",
  "{topic} gaf me tweedehands adrenaline.",
];
const SIM_CALLBACK_LEADS = [
  "net zei iemand",
  "quote van daarnet",
  "ik hoorde net",
  "dit werd net geroepen",
  "die ene was",
  "de chat dropte net",
  "ik kan nog steeds niet over",
  "de beste one-liner tot nu toe was",
  "ik blijf hangen op",
  "hier moest ik om lachen:",
  "samenvatting van vandaag:",
  "de quote van de avond:",
  "ik citeer even:",
  "deze viel net:",
];
const SIM_CALLBACK_PUNCHES = [
  "ja exact dit.",
  "ik ga kapot.",
  "dat was raak.",
  "dit vat alles samen.",
  "die was te goed.",
  "einde discussie.",
  "ik kan hier niet tegenin.",
  "dit was pijnlijk accuraat.",
  "deze zin gaat de geschiedenis in.",
  "hier was ik meteen om.",
  "dit was een directe KO.",
  "de zaal lag meteen plat.",
  "ik wil dit op een mok.",
  "dit was tegelijk dom en briljant.",
  "meer hoef je niet te zeggen.",
  "dit was de winnaar.",
];
const SIM_SAFE_FALLBACKS = [
  "wow",
  "haha",
  "ik ga stuk",
  "dit ga ik sturen",
  "te grappig",
  "hoe dan",
  "wat een timing",
  "ik ben om",
  "dit is goud",
  "te goed",
  "dit was wild",
  "ik had dit nodig",
  "ik sla hier op aan",
  "dit is exact mijn humor",
  "nee ik ga stuk",
];
const SIM_SHORT_REACTIONS = [
  "wow",
  "haha",
  "hahaha",
  "lol",
  "lmao",
  "ik ga stuk",
  "ik ben klaar",
  "ik lig dubbel",
  "ik hap naar lucht",
  "ik ben weg",
  "ik kan niet meer",
  "hoe dan",
  "hoe is dit echt",
  "wat is dit",
  "wat gebeurt hier",
  "wat een timing",
  "wat een entree",
  "wat een bocht",
  "wat een scene",
  "ik had dit niet verwacht",
  "dit escaleerde snel",
  "dit liep direct uit de hand",
  "dit ontspoort heerlijk",
  "dit had vaart",
  "dit was smerig goed",
  "dit was hard",
  "dit was raak",
  "dit was gemeen goed",
  "dit was pijnlijk grappig",
  "dit was illegaal grappig",
  "dit was premium chaos",
  "dit was internet op topvorm",
  "dit is te goed",
  "dit is zo dom goed",
  "dit is exact mijn humor",
  "dit is peak internet",
  "dit is content",
  "dit is goud",
  "dit is cinema",
  "dit is theater",
  "dit is mijn roman empire",
  "dit hoort in een museum",
  "ik huil",
  "ik huil van het lachen",
  "ik tril",
  "ik ben om",
  "ik ben verkocht",
  "ik ben overtuigd",
  "ik ben een simpele ziel",
  "ik mopper maar ik geniet",
  "ik doe cynisch maar dit is top",
  "ik wil klagen maar ik lach",
  "ik voel me gezien",
  "ik stuur dit door",
  "dit ga ik sturen",
  "dit ga ik aan vrienden laten zien",
  "dit ga ik naar mijn moeder sturen",
  "ik wil een replay",
  "ik wil een compilatie",
  "nog een keer",
  "meer hiervan",
  "ga door",
  "niet normaal",
  "te goed",
  "te scherp",
  "te echt",
  "te veel en precies genoeg",
  "nee joh",
  "hou op hoor",
  "stop ik kan niet meer",
  "ik ga kapot",
  "die kwam hard binnen",
  "die zat goed",
  "die was goor goed",
  "die deed pijn",
  "die was zuiver",
  "die was op tijd",
  "deze was raak",
  "deze was gemeen",
  "dit was een directe KO",
  "ik had dit nodig",
  "dit redt mijn dag",
  "dit pakt me onverwacht",
  "dit landt veel te goed",
  "ik hoor niks meer ik lach alleen",
  "ik ben mentaal afwezig",
  "ik ben officieel fan",
  "dit is een frame waard",
  "dit is een sticker waard",
  "deze lijn was moordend",
  "ik was niet voorbereid",
  "deze energie is verdacht goed",
  "dit was zo droog",
  "deze was giftig grappig",
  "ik wil meer chaos",
  "ik blijf hiervoor wakker",
  "dit ging van 0 naar 100",
  "ik kijk dit terug",
  "ik ben te makkelijk hier",
  "dit was zo overbodig en toch perfect",
];
const SIM_NEGATIVE_REACTIONS = [
  "wat is dit",
  "dit is kut",
  "saaiii",
  "is dit grappig",
  "nee bedankt",
  "dit werkt niet",
  "meh",
  "ik voel dit niet",
  "dit is matig",
  "waar kijk ik naar",
  "dit is raar",
  "ik skip dit",
  "volgende",
  "dit doet niks voor mij",
  "hmm nee",
  "niet mijn ding",
  "beetje pijnlijk",
  "ik haak af",
  "dit is ongemakkelijk",
  "oke... maar waarom",
  "zwak dit",
  "kan beter",
  "ik ben niet overtuigd",
  "dit mist iets",
  "nee hoor",
  "ik haat dit op een persoonlijke manier",
  "mijn geduld is net verdampt",
  "dit verdient een boze memo",
  "ik wil dit rapporteren aan mijn planten",
  "ik ben hier allergisch voor en toch blijf ik",
  "dit is beledigend goed",
  "dit is slecht voor mijn bloeddruk",
  "dit was een aanslag op mijn rust",
  "ik keur dit af met volle overgave",
  "dit sloopt mijn laatste beetje kalmte",
  "ik voel me aangevallen door deze timing",
  "dit is irritant raak",
  "ik wil hiertegen in beroep",
  "dit is juridisch te grappig",
  "ik ben boos en onder de indruk",
  "dit was een agressieve binnenkomer",
  "ik heb hier vijandige bewondering voor",
  "ik ga klagen en daarna terugkijken",
  "dit was gemeen en ik noteer het",
  "ik wil dit niet leuk vinden maar daar zijn we",
  "dit voelt als een subtiele oorvijg",
  "ik eis emotionele compensatie",
  "mijn innerlijke hater heeft applaus",
  "ik ben nog nooit zo kritisch akkoord gegaan",
];
const SIM_CHAT_PREFIXES = [
  "eerlijk",
  "not gonna lie",
  "ik zweer",
  "nee maar",
  "ok maar",
  "bro",
  "chef",
  "vrienden",
  "help",
  "luister",
  "serieus",
  "kleine update",
  "mini recap",
  "fact check",
  "status",
  "for real",
  "zonder grap",
  "met droge ogen",
  "respectvol",
  "tussen ons",
];
const SIM_CHAT_AFTERTHOUGHTS = [
  "ik herstel hier niet van.",
  "mijn dag is gemaakt.",
  "ik had dit exact nu nodig.",
  "dit was echt een klap in mijn schema.",
  "ik ben hier te vatbaar voor.",
  "dit was te scherp voor deze tijd.",
  "ik ga dit later weer kijken.",
  "dit was een replay-moment.",
  "ik voel tweedehands paniek en lol.",
  "mijn cynisme verloor hier.",
  "ik weet niet wie dit schreef maar bedankt.",
  "de timing was belachelijk goed.",
  "ik was er niet klaar voor.",
  "dit ging direct mijn favorieten in.",
  "het was onnodig en perfect.",
  "ik ben overtuigd zonder argumenten.",
  "ik wil dit op een shirt.",
  "ik had dit oprecht niet zien komen.",
  "dit is waarom ik niet weg klik.",
  "ik ga hier nog om lachen over een uur.",
];
const SIM_PERSONA_COMBO_TEMPLATES = [
  "{open}: {setup}, {twist}. {close}",
  "{setup}, {twist}. {close}",
  "{open}: {setup}. {close}",
  "{setup}. {close}",
  "{open}: {setup}, en eerlijk, {twist}.",
  "{setup} - {twist}.",
  "{open}: {setup}. {twist}. {close}",
];
const SIM_AUTHENTIC_TEMPLATES = [
  "{prefix}, {hit}",
  "{hit}. {after}",
  "{prefix}, {hit}. {after}",
  "{hit}",
  "{prefix}, {hit} {topicTail}",
];
const SIM_PERSONA_SNIPS = {
  deadpan_critic: [
    "ok dit was strak",
    "netjes gedaan",
    "die zat goed",
    "simpel en raak",
    "korte evaluatie: geslaagd",
    "ik ben kritisch maar dit werkt",
    "ik zie de fouten en toch applaus",
    "droge conclusie: sterk",
    "ik mopper zachtjes, maar ja",
    "de basis klopt gewoon",
    "dit was efficient grappig",
    "dit was beter dan de planning",
    "ik zag het aankomen en toch niet",
    "deze kwam klinisch hard binnen",
    "deze was strak afgemeten",
    "dit was exact genoeg",
  ],
  snarky_hype: [
    "dit escaleert snel",
    "ik hou hiervan",
    "chaos maar leuk",
    "dit is content",
    "ik steun deze wanorde",
    "dit ging van nul naar stadion",
    "deze ronde had lef",
    "dit was luid en effectief",
    "paniek maar premium",
    "dit is mijn soort drama",
    "ik keur dit goed met opgetrokken wenkbrauw",
    "dit had rook en karakter",
    "deze timing was smerig goed",
    "ik wil klagen maar ik blijf kijken",
    "deze edit was gewelddadig goed",
    "dit is chaos met swag",
  ],
  absurd_analyst: [
    "mijn brein crasht",
    "statistisch: ik lach",
    "dit slaat nergens op, top",
    "ik ben om",
    "mijn grafiek zegt ja",
    "data is in paniek, ik ook",
    "dit is wetenschappelijk hilarisch",
    "de lijn gaat omhoog en mijn verstand omlaag",
    "ik heb cijfers voor dit gevoel",
    "objectief gezien: ik ben weg",
    "ik maak een spreadsheet van deze chaos",
    "ik noem dit gecontroleerde ontsporing",
    "dit was een modelbreuk",
    "mijn analyse eindigt in applaus",
    "ik kan dit niet reproduceren maar wel waarderen",
    "theorie kapot, praktijk geweldig",
  ],
  friendly_roaster: [
    "lief bedoeld: dit is goud",
    "ik mopper en geniet tegelijk",
    "dit was pijnlijk grappig",
    "ok ik ben fan",
    "ik roast dit uit liefde",
    "ik doe streng maar ik lach",
    "ik ben kritisch met warme handen",
    "ik had klachten voorbereid, nu niet meer",
    "jullie maken het irritant goed",
    "ik wil negatief doen maar dat lukt niet",
    "deze chaos heeft manieren",
    "deze was gemeen en charmant",
    "ik haat dat ik dit leuk vind",
    "ik applaudisseer met tegenzin",
    "compliment met lichte schade",
    "dit was onverwacht aandoenlijk en gemeen",
  ],
};
const SIM_FIRST_NAMES = [
  "Noah",
  "Emma",
  "Liam",
  "Olivia",
  "Mila",
  "Levi",
  "Julia",
  "Finn",
  "Nora",
  "Daan",
  "Saar",
  "Mason",
  "Tess",
  "Sem",
  "Yara",
  "Vince",
  "Lotte",
  "Mats",
  "Zoey",
  "Jesse",
  "Luna",
  "Boaz",
  "Ava",
  "Ravi",
  "Iris",
  "Milan",
  "Nova",
  "Kai",
  "Lina",
  "Adam",
  "Maya",
  "Owen",
  "Elin",
  "Nina",
  "Hugo",
  "Rosa",
  "Milo",
  "Jade",
  "Tygo",
  "Evi",
  "Alex",
  "Sam",
  "Charlie",
  "Mika",
];
const SIM_EXTRA_EMOJIS = [
  "🥰",
  "🥵",
  "🤮",
  "🫦",
  "🍆",
  "💀",
  "😭",
  "🙏",
  "🔥",
  "✨",
  "🤡",
  "🫶",
  "🤭",
  "😩",
  "😮‍💨",
  "😳",
  "🤔",
  "🙄",
  "😬",
  "🫠",
  "😤",
  "😏",
  "👀",
  "🤨",
  "💅",
  "🧍",
  "🫥",
  "🚩",
  "🤌",
  "🗣️",
  "🫡",
  "☕️",
];
const SIM_EMOJI_COMBOS = [
  "👁️👄👁️",
  "👉👈",
  "💀⚰️",
  "✍️🔥",
  "📸🤨",
  "🍿👀",
  "🗿🍷",
];
const SIM_BRAINROT_REACTIONS = [
  "{term}",
  "mood: {term}",
  "vibe: {term}",
  "{term} vibes",
  "{term} energy",
  "{term} core",
  "dit voelde heel {term}",
  "dit was gewoon {term}",
  "dit kreeg meteen {term} status",
  "100 procent {term}",
  "meer {term} graag",
  "{term}, geen discussie",
  "{term} maar dan met extra chaos",
  "deze chat is vandaag {term}",
  "ik noem dit gewoon {term}",
  "plot twist: {term}",
  "samengevat: {term}",
  "alles aan dit moment was {term}",
  "dit segment schreeuwde {term}",
  "{term} in hoofdletters",
];
const SIM_BRAINROT_RAW_DROPS = [
  "{term}",
  "{term}.",
  "{term}!",
  "{term}?",
  "{term} {term}",
];
const ALLOWED_REACTIONS = ["heart", "fire", "laugh", "bored"];
const DEFAULT_REACTION_COUNTS = Object.freeze({
  heart: 0,
  fire: 0,
  laugh: 0,
  bored: 0,
});
const COMMON_TLDS = [
  "com",
  "net",
  "org",
  "nl",
  "be",
  "de",
  "eu",
  "io",
  "gg",
  "tv",
  "co",
  "me",
  "app",
  "dev",
  "info",
  "xyz",
  "ly",
  "to",
  "ai",
];
const TLD_PATTERN = `(?:${COMMON_TLDS.join("|")})`;
const DIRECT_LINK_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const DOMAIN_RE = new RegExp(
  String.raw`(?:^|\b)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+${TLD_PATTERN}(?:\b|\/)`,
  "i"
);
const LINK_SHORTENER_RE = /\b(?:bit\.ly|tinyurl\.com|t\.co|discord\.gg|t\.me|wa\.me)\b/i;
const PHONE_CANDIDATE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

/* OSC setup */
const OSC_HOST = process.env.OSC_HOST || "127.0.0.1";
const DEFAULT_OSC_PORT = clampInt(process.env.OSC_PORT || "1234", 1, 65535, 1234);
let currentOscPort = DEFAULT_OSC_PORT;

const udpPort = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: 0,
  remoteAddress: OSC_HOST,
  remotePort: DEFAULT_OSC_PORT,
  metadata: true,
});

udpPort.open();

udpPort.on("ready", () => {
  console.log(`OSC ready (default destination ${OSC_HOST}:${DEFAULT_OSC_PORT})`);
});

const app = express();
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DEBUG_LOG_PATH = path.join(__dirname, "debug.log");
function writeDebug(event, meta = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...meta,
  });
  fs.appendFile(DEBUG_LOG_PATH, line + "\n", () => {});
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampFloat(value, min, max, fallback) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseBooleanLike(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeSimText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSimText(input) {
  const normalized = normalizeSimText(input);
  if (!normalized) return [];
  return normalized.split(" ").filter((token) => token.length >= 2);
}

function simTokenOverlap(a, b) {
  const aTokens = tokenizeSimText(a);
  const bTokens = tokenizeSimText(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(aSet.size, bSet.size);
}

function pickWeighted(items) {
  if (!Array.isArray(items) || !items.length) return null;
  let total = 0;
  for (const item of items) {
    total += Math.max(0, Number(item && item.weight) || 0);
  }
  if (total <= 0) {
    return items[Math.floor(Math.random() * items.length)] || null;
  }
  let r = Math.random() * total;
  for (const item of items) {
    r -= Math.max(0, Number(item && item.weight) || 0);
    if (r <= 0) return item;
  }
  return items[items.length - 1] || null;
}

function isAllowedReaction(value) {
  return ALLOWED_REACTIONS.includes(String(value || ""));
}

function normalizeReactionType(input) {
  const value = String(input || "").trim().toLowerCase();
  return isAllowedReaction(value) ? value : "";
}

function createReactionCounts() {
  return {
    heart: 0,
    fire: 0,
    laugh: 0,
    bored: 0,
  };
}

function reactionCountsSnapshot(counts) {
  const src = counts || DEFAULT_REACTION_COUNTS;
  return {
    heart: Number(src.heart || 0),
    fire: Number(src.fire || 0),
    laugh: Number(src.laugh || 0),
    bored: Number(src.bored || 0),
  };
}

function sanitizeClientTag(input) {
  const tag = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  return tag || "anon";
}

function normalizeIp(ip) {
  const raw = String(ip || "unknown");
  if (raw === "::1") return "127.0.0.1";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

function buildClientKey(ip, clientTag) {
  return `${normalizeIp(ip)}|${sanitizeClientTag(clientTag)}`;
}

function normalizeClientKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const separatorIndex = raw.indexOf("|");
  if (separatorIndex <= 0) return "";
  const ip = normalizeIp(raw.slice(0, separatorIndex));
  const tag = sanitizeClientTag(raw.slice(separatorIndex + 1));
  if (!ip || !tag) return "";
  return `${ip}|${tag}`;
}

function extractIpFromClientKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const separatorIndex = raw.indexOf("|");
  if (separatorIndex >= 0) return normalizeIp(raw.slice(0, separatorIndex));
  return normalizeIp(raw);
}

function normalizeTargetKind(input) {
  const kind = String(input || "").trim().toLowerCase();
  if (kind === "client" || kind === "ip") return kind;
  return "";
}

function getConnectedClientByClientKey(clientKey) {
  const normalizedKey = normalizeClientKey(clientKey);
  if (!normalizedKey) return null;
  for (const client of connectedClients.values()) {
    if (String(client.clientKey || "") === normalizedKey) return client;
  }
  return null;
}

function isBotClientKey(clientKey) {
  const normalizedKey = normalizeClientKey(clientKey);
  if (!normalizedKey) return false;

  const connectedClient = getConnectedClientByClientKey(normalizedKey);
  if (connectedClient) {
    return isSimulatorBotIdentity(connectedClient, connectedClient.name, connectedClient.clientTag);
  }

  const separatorIndex = normalizedKey.indexOf("|");
  const clientTag = separatorIndex >= 0 ? normalizedKey.slice(separatorIndex + 1) : "";
  return isSimulatorClientTag(clientTag);
}

function toModerationScopeKey(scope) {
  if (!scope || !scope.kind) return "";
  if (scope.kind === "client") {
    const clientKey = normalizeClientKey(scope.clientKey);
    if (!clientKey) return "";
    return `client:${clientKey}`;
  }
  const ip = normalizeIp(scope.ip);
  if (!ip) return "";
  return `ip:${ip}`;
}

function parseModerationScopeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (raw.startsWith("client:")) {
    const clientKey = normalizeClientKey(raw.slice(7));
    if (!clientKey) return null;
    const scope = {
      kind: "client",
      clientKey,
      ip: extractIpFromClientKey(clientKey),
    };
    scope.scopeKey = toModerationScopeKey(scope);
    return scope;
  }

  if (raw.startsWith("ip:")) {
    const ip = normalizeIp(raw.slice(3));
    if (!ip) return null;
    const scope = { kind: "ip", ip, clientKey: "" };
    scope.scopeKey = toModerationScopeKey(scope);
    return scope;
  }

  if (raw.includes("|")) {
    const clientKey = normalizeClientKey(raw);
    if (clientKey && isBotClientKey(clientKey)) {
      const scope = {
        kind: "client",
        clientKey,
        ip: extractIpFromClientKey(clientKey),
      };
      scope.scopeKey = toModerationScopeKey(scope);
      return scope;
    }
    const ip = extractIpFromClientKey(raw);
    if (!ip) return null;
    const scope = { kind: "ip", ip, clientKey: "" };
    scope.scopeKey = toModerationScopeKey(scope);
    return scope;
  }

  const ip = normalizeIp(raw);
  if (!ip) return null;
  const scope = { kind: "ip", ip, clientKey: "" };
  scope.scopeKey = toModerationScopeKey(scope);
  return scope;
}

function resolveModerationScope(target, options = {}) {
  const preferredKind = normalizeTargetKind(options.kind || (target && (target.targetKind || target.kind)));

  let rawClientKey = "";
  let clientKey = "";
  let ip = "";

  if (typeof target === "string") {
    const parsed = parseModerationScopeKey(target);
    if (parsed && !preferredKind) return parsed;
    if (parsed) {
      clientKey = parsed.clientKey || "";
      ip = parsed.ip || "";
    } else if (target.includes("|")) {
      clientKey = normalizeClientKey(target);
      ip = extractIpFromClientKey(target);
    } else {
      ip = normalizeIp(target);
    }
  } else if (target && typeof target === "object") {
    if (target.clientKey) {
      rawClientKey = String(target.clientKey || "").trim();
      clientKey = normalizeClientKey(rawClientKey);
    }
    if (target.ip) ip = normalizeIp(target.ip);
  }

  if (!ip && !clientKey && rawClientKey && preferredKind === "ip") {
    ip = normalizeIp(rawClientKey);
  }
  if (!ip && clientKey) ip = extractIpFromClientKey(clientKey);

  let kind = preferredKind;
  if (!kind) {
    if (clientKey && isBotClientKey(clientKey)) kind = "client";
    else if (ip) kind = "ip";
    else if (clientKey) kind = "client";
  }

  if (kind === "client") {
    if (!clientKey) return null;
    const scope = { kind, clientKey, ip };
    scope.scopeKey = toModerationScopeKey(scope);
    return scope.scopeKey ? scope : null;
  }

  if (kind === "ip") {
    if (!ip && rawClientKey) ip = normalizeIp(rawClientKey);
    if (!ip) return null;
    const scope = { kind, ip, clientKey };
    scope.scopeKey = toModerationScopeKey(scope);
    return scope.scopeKey ? scope : null;
  }

  return null;
}

function resolveTargetIp(target) {
  const scope = resolveModerationScope(target, { kind: "ip" });
  return scope && scope.ip ? scope.ip : "";
}

function parseIsoTime(value) {
  if (!value) return null;
  const ts = Date.parse(String(value));
  if (!Number.isFinite(ts)) return null;
  return ts;
}

function getNameColorHex(name) {
  const hash = crypto.createHash("md5").update(String(name || "Anoniem")).digest();
  const toChannel = (n) => 0x55 + (n % 128);
  const r = toChannel(hash[0]);
  const g = toChannel(hash[1]);
  const b = toChannel(hash[2]);
  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  ).toUpperCase();
}

function sendOsc(address, args, meta = {}) {
  try {
    udpPort.send({ address, args }, OSC_HOST, currentOscPort);
    return true;
  } catch (e) {
    writeDebug("osc_send_error", {
      address,
      oscHost: OSC_HOST,
      oscPort: currentOscPort,
      message: e && e.message ? e.message : "unknown",
      ...meta,
    });
    return false;
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 3000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    time TEXT NOT NULL,
    client_id INTEGER,
    client_key TEXT,
    ip TEXT,
    name TEXT,
    text TEXT,
    status TEXT NOT NULL,
    detail TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_status ON chat_messages(session_id, status);

  CREATE TABLE IF NOT EXISTS moderation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    time TEXT NOT NULL,
    action_type TEXT NOT NULL,
    client_key TEXT NOT NULL,
    client_label TEXT,
    reason TEXT,
    expires_at TEXT,
    created_by TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_moderation_actions_session ON moderation_actions(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_moderation_actions_client ON moderation_actions(session_id, client_key, id);

  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_by TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_polls_session ON polls(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status, id);

  CREATE TABLE IF NOT EXISTS poll_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    client_key TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    voted_at TEXT NOT NULL,
    UNIQUE(poll_id, client_key),
    FOREIGN KEY(poll_id) REFERENCES polls(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id, option_index);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_trusted_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selector TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    last_ip TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_admin_trusted_devices_selector ON admin_trusted_devices(selector);
  CREATE INDEX IF NOT EXISTS idx_admin_trusted_devices_expiry ON admin_trusted_devices(expires_at);
`);

const pollColumns = db.prepare("PRAGMA table_info(polls)").all();
if (!pollColumns.some((column) => String(column.name || "") === "duration_seconds")) {
  db.exec(`ALTER TABLE polls ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_POLL_DURATION_SECONDS}`);
}

const sql = {
  getOpenSession: db.prepare(
    `SELECT id, name, started_at AS startedAt, ended_at AS endedAt
     FROM sessions
     WHERE ended_at IS NULL
     ORDER BY id DESC
     LIMIT 1`
  ),
  closeOpenSessions: db.prepare(`UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL`),
  insertSession: db.prepare(`INSERT INTO sessions (name, started_at) VALUES (?, ?)`),
  getSessionById: db.prepare(
    `SELECT id, name, started_at AS startedAt, ended_at AS endedAt
     FROM sessions
     WHERE id = ?`
  ),
  insertChatMessage: db.prepare(
    `INSERT INTO chat_messages (
      session_id, time, client_id, client_key, ip, name, text, status, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  countAcceptedMessages: db.prepare(
    `SELECT COUNT(1) AS n FROM chat_messages WHERE session_id = ? AND status = 'accepted'`
  ),
  countRejectedMessages: db.prepare(
    `SELECT COUNT(1) AS n FROM chat_messages WHERE session_id = ? AND status <> 'accepted'`
  ),
  getRecentMessages: db.prepare(
    `SELECT id, time, name, text, status, detail, client_key AS clientKey, ip
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY id DESC
     LIMIT ?`
  ),
  getRecentMessagesByIp: db.prepare(
    `SELECT id, time, name, text, status, detail, client_key AS clientKey, ip
     FROM chat_messages
     WHERE session_id = ? AND ip = ?
     ORDER BY id DESC
     LIMIT ?`
  ),
  getRecentMessagesByClientKey: db.prepare(
    `SELECT id, time, name, text, status, detail, client_key AS clientKey, ip
     FROM chat_messages
     WHERE session_id = ? AND client_key = ?
     ORDER BY id DESC
     LIMIT ?`
  ),
  insertModerationAction: db.prepare(
    `INSERT INTO moderation_actions (
      session_id, time, action_type, client_key, client_label, reason, expires_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getSessionModerationActions: db.prepare(
    `SELECT id, action_type AS actionType, client_key AS clientKey, expires_at AS expiresAt
     FROM moderation_actions
     WHERE session_id = ?
     ORDER BY id ASC`
  ),
  getRecentModerationActions: db.prepare(
    `SELECT id, time, action_type AS actionType, client_key AS clientKey, client_label AS clientLabel, reason, expires_at AS expiresAt, created_by AS createdBy
     FROM moderation_actions
     WHERE session_id = ?
     ORDER BY id DESC
     LIMIT ?`
  ),
  insertPoll: db.prepare(
    `INSERT INTO polls (session_id, question, options_json, duration_seconds, status, started_at, created_by)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ),
  closePollById: db.prepare(`UPDATE polls SET status = 'closed', ended_at = ? WHERE id = ? AND status = 'active'`),
  getActivePoll: db.prepare(
    `SELECT id, session_id AS sessionId, question, options_json AS optionsJson, duration_seconds AS durationSeconds, status, started_at AS startedAt, ended_at AS endedAt, created_by AS createdBy
     FROM polls
     WHERE session_id = ? AND status = 'active'
     ORDER BY id DESC
     LIMIT 1`
  ),
  getLatestPoll: db.prepare(
    `SELECT id, session_id AS sessionId, question, options_json AS optionsJson, duration_seconds AS durationSeconds, status, started_at AS startedAt, ended_at AS endedAt, created_by AS createdBy
     FROM polls
     WHERE session_id = ?
     ORDER BY id DESC
     LIMIT 1`
  ),
  insertPollVoteIfNew: db.prepare(
    `INSERT OR IGNORE INTO poll_votes (poll_id, client_key, option_index, voted_at)
     VALUES (?, ?, ?, ?)`
  ),
  getPollVoteCounts: db.prepare(
    `SELECT option_index AS optionIndex, COUNT(1) AS votes
     FROM poll_votes
     WHERE poll_id = ?
     GROUP BY option_index`
  ),
  insertTrustedAdminDevice: db.prepare(
    `INSERT INTO admin_trusted_devices (
      selector, token_hash, label, created_at, last_used_at, last_ip, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
  ),
  getTrustedAdminDeviceBySelector: db.prepare(
    `SELECT id, selector, token_hash AS tokenHash, label, expires_at AS expiresAt, revoked_at AS revokedAt
     FROM admin_trusted_devices
     WHERE selector = ?
     LIMIT 1`
  ),
  rotateTrustedAdminDevice: db.prepare(
    `UPDATE admin_trusted_devices
     SET selector = ?, token_hash = ?, label = ?, last_used_at = ?, last_ip = ?, expires_at = ?, revoked_at = NULL
     WHERE id = ?`
  ),
  revokeTrustedAdminDeviceById: db.prepare(
    `UPDATE admin_trusted_devices
     SET revoked_at = ?
     WHERE id = ?`
  ),
  pruneTrustedAdminDevices: db.prepare(
    `DELETE FROM admin_trusted_devices
     WHERE expires_at <= ? OR revoked_at IS NOT NULL`
  ),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  upsertSetting: db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ),
};

function getSetting(key, fallback = "") {
  const row = sql.getSetting.get(key);
  if (!row || typeof row.value !== "string") return fallback;
  return row.value;
}

function setSetting(key, value) {
  sql.upsertSetting.run(String(key), String(value), nowIso());
}

function loadSimulatorDefaultsFromSettings() {
  const raw = getSetting(SIM_DEFAULTS_SETTING_KEY, "");
  if (!raw) return normalizeSimulatorConfig(SIM_DEFAULTS, SIM_DEFAULTS);
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== "object") return normalizeSimulatorConfig(SIM_DEFAULTS, SIM_DEFAULTS);
  return normalizeSimulatorConfig(parsed, SIM_DEFAULTS);
}

function saveSimulatorDefaults(config) {
  const normalized = normalizeSimulatorConfig(config, SIM_DEFAULTS);
  setSetting(SIM_DEFAULTS_SETTING_KEY, safeJsonStringify(normalized, "{}"));
  return normalized;
}

if (!process.env.PORT) {
  PORT = clampInt(getSetting("next_port", String(PORT)), 1, 65535, PORT);
}

currentPollDurationSeconds = clampInt(
  getSetting("poll_duration_seconds", String(DEFAULT_POLL_DURATION_SECONDS)),
  5,
  3600,
  DEFAULT_POLL_DURATION_SECONDS
);
setSetting("poll_duration_seconds", String(currentPollDurationSeconds));

currentOscPort = clampInt(
  getSetting("osc_port", String(DEFAULT_OSC_PORT)),
  1,
  65535,
  DEFAULT_OSC_PORT
);
setSetting("osc_port", String(currentOscPort));
const SIM_RUNTIME_DEFAULTS = saveSimulatorDefaults(loadSimulatorDefaultsFromSettings());
console.log(`OSC destination active: ${OSC_HOST}:${currentOscPort}`);

function ensureOpenSession() {
  const existing = sql.getOpenSession.get();
  if (existing) return existing;

  const startedAt = nowIso();
  const defaultName = "Performance " + startedAt.slice(0, 16).replace("T", " ");
  const insert = sql.insertSession.run(defaultName, startedAt);
  return sql.getSessionById.get(insert.lastInsertRowid);
}

function parsePollRow(row) {
  if (!row) return null;
  const options = safeJsonParse(row.optionsJson, []);
  const safeOptions = Array.isArray(options)
    ? options.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const durationSeconds = clampInt(row.durationSeconds, 5, 3600, currentPollDurationSeconds);
  return {
    id: Number(row.id),
    sessionId: Number(row.sessionId),
    question: String(row.question || ""),
    options: safeOptions,
    durationSeconds,
    status: String(row.status || "closed"),
    startedAt: String(row.startedAt || ""),
    endedAt: row.endedAt ? String(row.endedAt) : null,
    createdBy: row.createdBy ? String(row.createdBy) : null,
  };
}

function getPollResults(poll) {
  if (!poll) return { counts: [], totalVotes: 0 };
  const counts = poll.options.map(() => 0);
  const rows = sql.getPollVoteCounts.all(poll.id);
  for (const row of rows) {
    const idx = Number(row.optionIndex);
    const votes = Number(row.votes || 0);
    if (Number.isInteger(idx) && idx >= 0 && idx < counts.length) {
      counts[idx] = votes;
    }
  }
  return { counts, totalVotes: counts.reduce((sum, n) => sum + n, 0) };
}

const adminTokens = new Map();
const connectedClients = new Map();
const mutedUsers = new Map();
const blockedUsers = new Map();
let currentSession = ensureOpenSession();
let activePoll = parsePollRow(sql.getActivePoll.get(currentSession.id));
let reactionCounts = createReactionCounts();
let pollAutoCloseTimer = null;

function getPollEndsAtIso(poll) {
  if (!poll || !poll.startedAt) return null;
  const startedTs = parseIsoTime(poll.startedAt);
  if (!startedTs) return null;
  const durationSeconds = clampInt(poll.durationSeconds, 5, 3600, currentPollDurationSeconds);
  return new Date(startedTs + durationSeconds * 1000).toISOString();
}

function clearPollAutoCloseTimer() {
  if (!pollAutoCloseTimer) return;
  clearTimeout(pollAutoCloseTimer);
  pollAutoCloseTimer = null;
}

function rebuildEnforcementState() {
  mutedUsers.clear();
  blockedUsers.clear();

  const rows = sql.getSessionModerationActions.all(currentSession.id);
  for (const row of rows) {
    const scope = parseModerationScopeKey(String(row.clientKey || ""));
    if (!scope || !scope.scopeKey) continue;
    const actionType = String(row.actionType || "");
    const expiresAt = row.expiresAt ? String(row.expiresAt) : null;
    const state = {
      expiresAt,
      targetKind: scope.kind,
      targetIp: scope.ip || null,
      targetClientKey: scope.clientKey || null,
    };

    if (actionType === "mute") {
      mutedUsers.set(scope.scopeKey, state);
      continue;
    }
    if (actionType === "unmute") {
      mutedUsers.delete(scope.scopeKey);
      continue;
    }
    if (actionType === "block") {
      blockedUsers.set(scope.scopeKey, state);
      continue;
    }
    if (actionType === "unblock") {
      blockedUsers.delete(scope.scopeKey);
    }
  }
}

function cleanupEnforcementMaps() {
  const now = Date.now();
  for (const [scopeKey, state] of mutedUsers.entries()) {
    const ts = parseIsoTime(state && state.expiresAt);
    if (ts && ts <= now) mutedUsers.delete(scopeKey);
  }
  for (const [scopeKey, state] of blockedUsers.entries()) {
    const ts = parseIsoTime(state && state.expiresAt);
    if (ts && ts <= now) blockedUsers.delete(scopeKey);
  }
}

function getMuteState(target) {
  const scope = resolveModerationScope(target);
  if (!scope || !scope.scopeKey) return null;
  cleanupEnforcementMaps();
  const state = mutedUsers.get(scope.scopeKey);
  if (!state) return null;
  const ts = parseIsoTime(state.expiresAt);
  if (ts && ts <= Date.now()) {
    mutedUsers.delete(scope.scopeKey);
    return null;
  }
  return {
    ...state,
    targetKind: state.targetKind || scope.kind,
    targetIp: state.targetIp || scope.ip || null,
    targetClientKey: state.targetClientKey || scope.clientKey || null,
  };
}

function getBlockState(target) {
  const scope = resolveModerationScope(target);
  if (!scope || !scope.scopeKey) return null;
  cleanupEnforcementMaps();
  const state = blockedUsers.get(scope.scopeKey);
  if (!state) return null;
  const ts = parseIsoTime(state.expiresAt);
  if (ts && ts <= Date.now()) {
    blockedUsers.delete(scope.scopeKey);
    return null;
  }
  return {
    ...state,
    targetKind: state.targetKind || scope.kind,
    targetIp: state.targetIp || scope.ip || null,
    targetClientKey: state.targetClientKey || scope.clientKey || null,
  };
}

function recordModerationAction(actionType, clientKey, clientLabel, reason, expiresAt, createdBy) {
  sql.insertModerationAction.run(
    currentSession.id,
    nowIso(),
    actionType,
    String(clientKey || ""),
    String(clientLabel || ""),
    reason ? String(reason) : null,
    expiresAt ? String(expiresAt) : null,
    createdBy ? String(createdBy) : null
  );
}

function recordChatMessage({ clientId, clientKey, ip, name, text, status, detail }) {
  sql.insertChatMessage.run(
    currentSession.id,
    nowIso(),
    Number(clientId || 0),
    String(clientKey || ""),
    String(ip || ""),
    String(name || ""),
    String(text || ""),
    String(status || "accepted"),
    detail ? String(detail) : null
  );
}

function pruneAdminTokens() {
  const now = Date.now();
  for (const [token, expiresAt] of adminTokens.entries()) {
    if (expiresAt <= now) adminTokens.delete(token);
  }
}

function isTruthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "1" || lowered === "true" || lowered === "yes" || lowered === "on";
  }
  return false;
}

function isHttpsRequest(req) {
  if (req.secure) return true;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return forwardedProto.includes("https");
}

function parseCookieHeader(header) {
  const out = {};
  const raw = String(header || "");
  if (!raw) return out;
  const parts = raw.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    const value = trimmed.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value || ""))}`];
  parts.push(`Path=${options.path || "/"}`);
  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.expires instanceof Date) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite || "Strict"}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function readTrustedAdminDeviceToken(req) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return String(cookies[ADMIN_TRUSTED_DEVICE_COOKIE] || "").trim();
}

function parseTrustedAdminDeviceToken(rawToken) {
  const raw = String(rawToken || "").trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const selector = parts[0].toLowerCase();
  const secret = parts[1].toLowerCase();
  const selectorLen = ADMIN_TRUSTED_SELECTOR_BYTES * 2;
  const secretLen = ADMIN_TRUSTED_SECRET_BYTES * 2;
  if (!new RegExp(`^[a-f0-9]{${selectorLen}}$`).test(selector)) return null;
  if (!new RegExp(`^[a-f0-9]{${secretLen}}$`).test(secret)) return null;
  return { selector, secret, raw: `${selector}.${secret}` };
}

function hashTrustedAdminDeviceToken(selector, secret) {
  return crypto.createHash("sha256").update(`${selector}.${secret}`).digest("hex");
}

function timingSafeHexEqual(left, right) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  if (!/^[a-f0-9]+$/.test(a) || !/^[a-f0-9]+$/.test(b)) return false;
  const leftBuf = Buffer.from(a, "hex");
  const rightBuf = Buffer.from(b, "hex");
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function sanitizeDeviceLabel(input) {
  const label = String(input || "").trim().slice(0, 160);
  return label || null;
}

function pruneTrustedAdminDevices() {
  sql.pruneTrustedAdminDevices.run(nowIso());
}

function createTrustedAdminDeviceCredential() {
  const selector = crypto.randomBytes(ADMIN_TRUSTED_SELECTOR_BYTES).toString("hex");
  const secret = crypto.randomBytes(ADMIN_TRUSTED_SECRET_BYTES).toString("hex");
  const rawToken = `${selector}.${secret}`;
  const tokenHash = hashTrustedAdminDeviceToken(selector, secret);
  return { selector, tokenHash, rawToken };
}

function setTrustedAdminDeviceCookie(res, req, rawToken, expiresAtIso) {
  const expiresTs = parseIsoTime(expiresAtIso);
  const maxAgeSeconds = expiresTs ? Math.max(0, Math.floor((expiresTs - Date.now()) / 1000)) : 0;
  res.append(
    "Set-Cookie",
    serializeCookie(ADMIN_TRUSTED_DEVICE_COOKIE, rawToken, {
      path: "/",
      maxAge: maxAgeSeconds,
      expires: expiresTs ? new Date(expiresTs) : new Date(0),
      httpOnly: true,
      sameSite: "Strict",
      secure: isHttpsRequest(req),
    })
  );
}

function clearTrustedAdminDeviceCookie(res, req) {
  res.append(
    "Set-Cookie",
    serializeCookie(ADMIN_TRUSTED_DEVICE_COOKIE, "", {
      path: "/",
      maxAge: 0,
      expires: new Date(0),
      httpOnly: true,
      sameSite: "Strict",
      secure: isHttpsRequest(req),
    })
  );
}

function issueTrustedAdminDeviceRecord({ ip, label }) {
  pruneTrustedAdminDevices();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ADMIN_TRUSTED_DEVICE_TTL_MS).toISOString();
  const safeIp = normalizeIp(ip || "unknown");
  const safeLabel = sanitizeDeviceLabel(label);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const credential = createTrustedAdminDeviceCredential();
    try {
      sql.insertTrustedAdminDevice.run(
        credential.selector,
        credential.tokenHash,
        safeLabel,
        createdAt,
        createdAt,
        safeIp,
        expiresAt
      );
      return { rawToken: credential.rawToken, expiresAt };
    } catch (err) {
      const message = String(err && err.message ? err.message : "");
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  throw new Error("trusted_device_issue_failed");
}

function getTrustedAdminDeviceFromRequest(req) {
  pruneTrustedAdminDevices();
  const parsed = parseTrustedAdminDeviceToken(readTrustedAdminDeviceToken(req));
  if (!parsed) return null;
  const row = sql.getTrustedAdminDeviceBySelector.get(parsed.selector);
  if (!row) return null;
  if (row.revokedAt) return null;
  const expiresAtTs = parseIsoTime(row.expiresAt);
  if (!expiresAtTs || expiresAtTs <= Date.now()) return null;
  const expectedHash = hashTrustedAdminDeviceToken(parsed.selector, parsed.secret);
  if (!timingSafeHexEqual(expectedHash, row.tokenHash)) return null;
  return { row, parsed };
}

function rotateTrustedAdminDeviceRecord(row, { ip }) {
  const safeIp = normalizeIp(ip || "unknown");
  const lastUsedAt = nowIso();
  const expiresAt = new Date(Date.now() + ADMIN_TRUSTED_DEVICE_TTL_MS).toISOString();
  const safeLabel = sanitizeDeviceLabel(row.label);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const credential = createTrustedAdminDeviceCredential();
    try {
      sql.rotateTrustedAdminDevice.run(
        credential.selector,
        credential.tokenHash,
        safeLabel,
        lastUsedAt,
        safeIp,
        expiresAt,
        Number(row.id)
      );
      return { rawToken: credential.rawToken, expiresAt };
    } catch (err) {
      const message = String(err && err.message ? err.message : "");
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  throw new Error("trusted_device_rotate_failed");
}

function revokeTrustedAdminDeviceByRequest(req) {
  const trusted = getTrustedAdminDeviceFromRequest(req);
  if (!trusted) return false;
  const result = sql.revokeTrustedAdminDeviceById.run(nowIso(), Number(trusted.row.id));
  return result.changes > 0;
}

let restartPending = false;

function requestServerRestart(requestedBy = "admin") {
  if (restartPending) return { alreadyPending: true };
  restartPending = true;

  let childPid = null;
  try {
    const child = spawn(process.execPath, [__filename], {
      cwd: __dirname,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ADMIN_RESTART_BOOT_DELAY_MS: String(ADMIN_RESTART_CHILD_BOOT_DELAY_MS),
      },
    });
    child.unref();
    childPid = Number(child.pid || 0);
  } catch (err) {
    restartPending = false;
    throw err;
  }

  writeDebug("server_restart_requested", {
    by: requestedBy,
    pid: process.pid,
    nextPid: childPid,
    childBootDelayMs: ADMIN_RESTART_CHILD_BOOT_DELAY_MS,
  });

  setTimeout(() => {
    writeDebug("server_restart_exit", { pid: process.pid, nextPid: childPid });
    process.exit(0);
  }, 180).unref();

  return {
    alreadyPending: false,
    childPid,
    childBootDelayMs: ADMIN_RESTART_CHILD_BOOT_DELAY_MS,
  };
}

function issueAdminToken() {
  pruneAdminTokens();
  const token = crypto.randomBytes(24).toString("hex");
  adminTokens.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  return token;
}

function readAdminToken(req) {
  const direct = String(req.headers["x-admin-token"] || "").trim();
  if (direct) return direct;
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function requireAdmin(req, res, next) {
  const token = readAdminToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  pruneAdminTokens();
  const expiresAt = adminTokens.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminTokens.delete(token);
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  req.adminToken = token;
  next();
}

function getClientLabel(target) {
  const scope = resolveModerationScope(target);
  if (!scope) return "iemand";
  return getModerationScopeDisplayLabel(scope);
}

function getModerationScopeDisplayLabel(scope) {
  if (!scope) return "iemand";

  if (scope.kind === "client") {
    for (const client of connectedClients.values()) {
      if (String(client.clientKey || "") !== String(scope.clientKey || "")) continue;
      const name = sanitizeName(client.name || "");
      if (name) return name;
    }
    return "iemand";
  }

  const targetIp = String(scope.ip || "");
  if (!targetIp) return "iemand";
  const sameIpClients = Array.from(connectedClients.values()).filter((client) => normalizeIp(client.ip) === targetIp);
  if (!sameIpClients.length) return "iemand";
  const preferred = sameIpClients.find((client) => String(client.name || "").trim()) || sameIpClients[0];
  return sanitizeName(preferred && preferred.name ? preferred.name : "iemand");
}

function buildModerationFeedText(actionType, scope, meta = {}) {
  const label = getModerationScopeDisplayLabel(scope);
  const action = String(actionType || "").trim().toLowerCase();
  if (action === "mute") {
    const minutes = clampInt(meta && meta.minutes, 1, 180, 0);
    const suffix = minutes > 0 ? ` (${minutes}m)` : "";
    return `${label} is gemute${suffix}.`;
  }
  if (action === "unmute") return `${label} is unmuted.`;
  if (action === "block") return `${label} is geblokkeerd.`;
  if (action === "unblock") return `${label} is gedeblokkeerd.`;
  if (action === "kick") return `${label} is verwijderd door moderatie.`;
  return "";
}

function publishModerationFeedNotice(actionType, scope, meta = {}) {
  const text = buildModerationFeedText(actionType, scope, meta);
  if (!text) return null;
  const now = nowIso();
  const speaker = "Moderatie";
  const payload = {
    type: "comment",
    time: now,
    name: speaker,
    text,
    nameColor: getNameColorHex(speaker),
    system: true,
  };
  recordChatMessage({
    clientId: 0,
    clientKey: scope && scope.kind === "client"
      ? String(scope.clientKey || "")
      : String((scope && scope.ip) || ""),
    ip: scope && scope.ip ? String(scope.ip) : "",
    name: speaker,
    text,
    status: "accepted",
    detail: `moderation_notice:${String(actionType || "")}`,
  });
  broadcastToClients(payload);
  return payload;
}

function closeActivePoll(reason = "closed", createdBy = "admin") {
  if (!activePoll) return false;
  clearPollAutoCloseTimer();
  const closingId = activePoll.id;
  const closedAt = nowIso();
  const result = sql.closePollById.run(closedAt, closingId);
  if (result.changes < 1) {
    activePoll = null;
    return false;
  }
  activePoll = null;
  writeDebug("poll_closed", { pollId: closingId, reason, createdBy });
  return true;
}

function scheduleActivePollAutoClose() {
  clearPollAutoCloseTimer();
  if (!activePoll) return;
  const endsAt = getPollEndsAtIso(activePoll);
  const endsAtTs = parseIsoTime(endsAt);
  if (!endsAtTs) return;

  const delayMs = endsAtTs - Date.now();
  if (delayMs <= 0) {
    const pollId = activePoll.id;
    if (closeActivePoll("poll_timeout", "system")) {
      broadcastToClients({ type: "poll_closed", pollId, reason: "timeout" });
      writeDebug("poll_auto_closed", { pollId, reason: "timeout", delayMs: 0 });
    }
    return;
  }

  pollAutoCloseTimer = setTimeout(() => {
    pollAutoCloseTimer = null;
    if (!activePoll) return;
    const pollId = activePoll.id;
    if (closeActivePoll("poll_timeout", "system")) {
      broadcastToClients({ type: "poll_closed", pollId, reason: "timeout" });
      writeDebug("poll_auto_closed", { pollId, reason: "timeout", delayMs });
    }
  }, delayMs);
}

function beginNewSession(name, createdBy = "admin") {
  const now = nowIso();
  const sessionName = String(name || "").trim() || ("Performance " + now.slice(0, 16).replace("T", " "));

  closeActivePoll("new_session", createdBy);
  sql.closeOpenSessions.run(now);
  const insert = sql.insertSession.run(sessionName, now);
  currentSession = sql.getSessionById.get(insert.lastInsertRowid);
  activePoll = null;
  reactionCounts = createReactionCounts();
  mutedUsers.clear();
  blockedUsers.clear();
  rateMap.clear();
  reactionRateMap.clear();
  return currentSession;
}

function getPollSnapshot() {
  if (!activePoll) return null;
  const results = getPollResults(activePoll);
  const endsAt = getPollEndsAtIso(activePoll);
  const endsAtTs = parseIsoTime(endsAt);
  return {
    id: activePoll.id,
    question: activePoll.question,
    options: activePoll.options,
    counts: results.counts,
    totalVotes: results.totalVotes,
    status: activePoll.status,
    startedAt: activePoll.startedAt,
    endsAt,
    durationSeconds: clampInt(activePoll.durationSeconds, 5, 3600, currentPollDurationSeconds),
    remainingMs: endsAtTs ? Math.max(0, endsAtTs - Date.now()) : null,
  };
}

function broadcastToClients(message) {
  const payload = safeJsonStringify(message, "{}");
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {}
    }
  }
}

function broadcastPollUpdate() {
  if (!activePoll) return;
  const results = getPollResults(activePoll);
  broadcastToClients({
    type: "poll_update",
    pollId: activePoll.id,
    counts: results.counts,
    totalVotes: results.totalVotes,
  });
}

function doesClientMatchScope(meta, scope) {
  if (!meta || !scope) return false;
  if (scope.kind === "client") {
    return String(meta.clientKey || "") === String(scope.clientKey || "");
  }
  return normalizeIp(meta.ip) === String(scope.ip || "");
}

function sendToTargetIp(target, message, options = {}) {
  const scope = resolveModerationScope(target, options);
  if (!scope) return 0;

  const payload = safeJsonStringify(message, "{}");
  let sent = 0;
  for (const client of wss.clients) {
    const meta = client && client.__meta;
    if (!doesClientMatchScope(meta, scope)) continue;
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(payload);
      sent += 1;
    } catch {}
  }
  return sent;
}

function normalizeSimulatorConfig(rawConfig = {}, baseConfig = SIM_DEFAULTS) {
  const base = baseConfig || SIM_DEFAULTS;
  const voteDelayMinMs = clampInt(rawConfig.voteDelayMinMs, 0, 60000, base.voteDelayMinMs);
  const voteDelayMaxMs = clampInt(rawConfig.voteDelayMaxMs, 0, 60000, base.voteDelayMaxMs);
  const legacySarcasm = clampFloat(rawConfig.sarcasm, 0, 1, base.negative);
  const legacyAbsurdity = clampFloat(rawConfig.absurdity, 0, 1, base.negative);
  const legacyNegative = clampFloat((legacySarcasm + legacyAbsurdity) / 2, 0, 1, base.negative);
  const negative = clampFloat(rawConfig.negative, 0, 1, legacyNegative);
  const positiveFallback = clampFloat(1 - legacyNegative * 0.62, 0, 1, base.positive);
  const positive = clampFloat(rawConfig.positive, 0, 1, positiveFallback);
  return {
    clients: clampInt(rawConfig.clients, 1, 200, base.clients),
    durationSec: clampInt(rawConfig.durationSec, 0, 24 * 60 * 60, base.durationSec),
    msgRate: clampFloat(rawConfig.msgRate, 0, 0.1, base.msgRate),
    reactionRate: clampFloat(rawConfig.reactionRate, 0, 4, base.reactionRate),
    emojiInlineRate: clampFloat(rawConfig.emojiInlineRate, 0, 1, base.emojiInlineRate),
    emojiLooseRate: clampFloat(rawConfig.emojiLooseRate, 0, 1, base.emojiLooseRate),
    spawnMs: clampInt(rawConfig.spawnMs, 0, 5000, base.spawnMs),
    minGapMs: clampInt(rawConfig.minGapMs, 200, 20000, base.minGapMs),
    autoVote: parseBooleanLike(rawConfig.autoVote, base.autoVote),
    pollVoteChance: clampFloat(rawConfig.pollVoteChance, 0, 1, base.pollVoteChance),
    voteDelayMinMs: Math.min(voteDelayMinMs, voteDelayMaxMs),
    voteDelayMaxMs: Math.max(voteDelayMinMs, voteDelayMaxMs),
    namePrefix: String(rawConfig.namePrefix || base.namePrefix || "SimUser")
      .trim()
      .replace(/\s+/g, "")
      .slice(0, 16) || "SimUser",
    topic: String(rawConfig.topic || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 120),
    positive,
    negative,
    callbackRate: clampFloat(rawConfig.callbackRate, 0, 1, base.callbackRate),
  };
}

function createEmptySimulatorStats() {
  return {
    startedAt: "",
    stoppedAt: "",
    stopReason: "",
    opened: 0,
    closed: 0,
    reconnects: 0,
    errors: 0,
    connectedNow: 0,
    maxConnected: 0,
    sentComments: 0,
    sentReactions: 0,
    recvComments: 0,
    sentVotes: 0,
    voteAcks: 0,
    serverErrors: 0,
    rateLimited: 0,
    blockedErrors: 0,
    mutedErrors: 0,
  };
}

class SimulatedBotClient {
  constructor(id, manager) {
    this.id = id;
    this.manager = manager;
    this.ws = null;
    this.connected = false;
    this.stopped = false;
    this.sendTimer = null;
    this.voteTimer = null;
    this.reconnectTimer = null;
    this.lastSentAt = 0;
    this.lastReactionAt = 0;
    this.nextMessageGapMs = 0;
    this.messageSeq = 0;
    this.activePoll = null;
    this.votedPollIds = new Set();
    this.clientTag = `sim-${String(id).padStart(3, "0")}-${Math.random().toString(36).slice(2, 6)}`;
    this.firstName = this.manager.makeBotFirstName();
    this.name = this.manager.formatBotDisplayName(this.firstName);
  }

  updateNamePrefix(_namePrefix) {
    if (!this.firstName) this.firstName = this.manager.makeBotFirstName();
    this.name = this.manager.formatBotDisplayName(this.firstName);
    if (this.connected) {
      this.sendJson({ type: "register", clientTag: this.clientTag, name: this.name });
    }
  }

  connect() {
    if (this.stopped || !this.manager.running) return;
    const wsUrl = this.manager.buildWsUrl(this.id);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      if (this.ws !== ws || this.stopped || !this.manager.running) return;
      this.connected = true;
      this.manager.stats.opened += 1;
      this.manager.stats.connectedNow += 1;
      this.manager.stats.maxConnected = Math.max(this.manager.stats.maxConnected, this.manager.stats.connectedNow);
      this.sendJson({ type: "register", clientTag: this.clientTag, name: this.name });
      this.startSendLoop();
    });

    ws.on("message", (raw) => {
      if (this.ws !== ws || this.stopped || !this.manager.running) return;
      this.handleMessage(raw);
    });

    ws.on("error", () => {
      this.manager.stats.errors += 1;
    });

    ws.on("close", () => {
      if (this.ws !== ws) return;
      if (this.connected) {
        this.manager.stats.connectedNow = Math.max(0, this.manager.stats.connectedNow - 1);
      }
      this.connected = false;
      this.manager.stats.closed += 1;
      this.stopLoops();
      this.ws = null;
      if (!this.stopped && this.manager.running) {
        this.manager.stats.reconnects += 1;
        const delay = this.manager.randomInt(400, 1300);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    });
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopLoops();
    if (this.ws) {
      try {
        this.ws.close(1000, "sim_stop");
      } catch {}
      this.ws = null;
    }
  }

  stopLoops() {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.voteTimer) clearTimeout(this.voteTimer);
    this.sendTimer = null;
    this.voteTimer = null;
  }

  computeNextMessageGapMs() {
    const base = clampInt(this.manager.config.minGapMs, 200, 20000, 2300);
    const scaled = Math.round(base * (0.58 + Math.random() * 0.95));
    const jitter = this.manager.randomInt(-180, 420);
    return clampInt(scaled + jitter, 320, 24000, base);
  }

  messageChanceForTick(tickMs = 1000) {
    const ratePerSecond = clampFloat(this.manager.config.msgRate, 0, 0.1, 0.03);
    const seconds = clampFloat(tickMs / 1000, 0.05, 3, 1);
    const chance = 1 - Math.pow(1 - ratePerSecond, seconds);
    return clampFloat(chance, 0, 0.95, ratePerSecond);
  }

  scheduleNextSendTick(minDelayMs = 220, maxDelayMs = 1250) {
    if (this.stopped || !this.manager.running) return;
    const minDelay = clampInt(minDelayMs, 60, 5000, 220);
    const maxDelay = clampInt(maxDelayMs, minDelay, 5000, Math.max(minDelay, 1250));
    const delay = this.manager.randomInt(minDelay, maxDelay);
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.processSendTick(delay);
    }, delay);
  }

  processSendTick(tickMs = 1000) {
    if (this.stopped || !this.manager.running) return;
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.scheduleNextSendTick(280, 860);
      return;
    }

    this.maybeSendReaction(tickMs);
    const now = Date.now();
    const gap = Math.max(180, this.nextMessageGapMs || this.computeNextMessageGapMs());
    const sinceLast = now - this.lastSentAt;
    const canSend = sinceLast >= gap;

    if (canSend && Math.random() <= this.messageChanceForTick(tickMs)) {
      this.messageSeq += 1;
      const text = this.manager.makeMessage(this.id, this.messageSeq);
      if (this.sendJson({ type: "comment", name: this.name, text, clientTag: this.clientTag })) {
        this.lastSentAt = Date.now();
        this.nextMessageGapMs = this.computeNextMessageGapMs();
        this.manager.stats.sentComments += 1;
      }
    }

    const remaining = Math.max(0, (this.nextMessageGapMs || gap) - (Date.now() - this.lastSentAt));
    if (remaining > 0 && remaining < 420) {
      this.scheduleNextSendTick(Math.max(90, remaining), Math.max(180, remaining + 240));
      return;
    }
    this.scheduleNextSendTick(220, 1250);
  }

  startSendLoop() {
    if (this.sendTimer) return;
    this.nextMessageGapMs = this.computeNextMessageGapMs();
    if (!this.lastSentAt) {
      this.lastSentAt = Date.now() - this.manager.randomInt(0, this.nextMessageGapMs);
    }
    this.scheduleNextSendTick(120, 980);
  }

  maybeSendReaction(tickMs = 1000) {
    const ratePerSecond = clampFloat(this.manager.config.reactionRate, 0, 4, 0.35);
    const seconds = clampFloat(tickMs / 1000, 0.05, 3, 1);
    const chance = clampFloat(ratePerSecond * seconds, 0, 1, ratePerSecond);
    if (Math.random() > chance) return;
    const now = Date.now();
    if (now - this.lastReactionAt < 180) return;
    const reaction = ALLOWED_REACTIONS[this.manager.randomInt(0, ALLOWED_REACTIONS.length - 1)];
    const sent = this.sendJson({ type: "reaction", reaction, clientTag: this.clientTag });
    if (!sent) return;
    this.lastReactionAt = now;
    this.manager.stats.sentReactions += 1;
  }

  maybeScheduleVote() {
    if (!this.manager.config.autoVote) return;
    if (!this.activePoll || !this.manager.running) return;
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!Array.isArray(this.activePoll.options) || this.activePoll.options.length < 2) return;
    const pollId = Number(this.activePoll.id);
    if (!Number.isInteger(pollId)) return;
    if (this.votedPollIds.has(pollId)) return;
    if (Math.random() > this.manager.config.pollVoteChance) return;

    if (this.voteTimer) clearTimeout(this.voteTimer);
    const delay = this.manager.randomInt(this.manager.config.voteDelayMinMs, this.manager.config.voteDelayMaxMs);
    this.voteTimer = setTimeout(() => {
      this.voteTimer = null;
      if (!this.activePoll || !this.manager.running) return;
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastSentAt < this.manager.config.minGapMs) return;
      const optionIndex = this.manager.randomInt(0, this.activePoll.options.length - 1);
      const sent = this.sendJson({
        type: "poll_vote",
        pollId,
        optionIndex,
        clientTag: this.clientTag,
      });
      if (!sent) return;
      this.lastSentAt = Date.now();
      this.manager.stats.sentVotes += 1;
      this.votedPollIds.add(pollId);
    }, delay);
  }

  handleMessage(raw) {
    let msg = null;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "comment") {
      this.manager.stats.recvComments += 1;
      return;
    }

    if (msg.type === "poll_started") {
      this.activePoll = msg.poll || null;
      this.maybeScheduleVote();
      return;
    }

    if (msg.type === "poll_closed") {
      this.activePoll = null;
      if (this.voteTimer) clearTimeout(this.voteTimer);
      this.voteTimer = null;
      return;
    }

    if (msg.type === "poll_vote_ok") {
      this.manager.stats.voteAcks += 1;
      const pollId = Number(msg.pollId);
      if (Number.isInteger(pollId)) this.votedPollIds.add(pollId);
      return;
    }

    if (msg.type === "error") {
      this.manager.stats.serverErrors += 1;
      const code = String(msg.code || "");
      if (code === "user_blocked") this.manager.stats.blockedErrors += 1;
      if (code === "user_muted") this.manager.stats.mutedErrors += 1;
      if (String(msg.message || "").toLowerCase().includes("slow down")) {
        this.manager.stats.rateLimited += 1;
      }
    }
  }

  sendJson(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
}

class ChatSimulatorManager {
  constructor() {
    this.running = false;
    this.config = normalizeSimulatorConfig(SIM_RUNTIME_DEFAULTS, SIM_DEFAULTS);
    this.stats = createEmptySimulatorStats();
    this.bots = [];
    this.stopTimer = null;
    this.recentObservedComments = [];
    this.recentGeneratedMessages = [];
    this.generatedPhraseCounts = new Map();
    this.generatedPrefixCounts = new Map();
    this.botProfiles = new Map();
  }

  randomInt(min, max) {
    if (max <= min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  sample(list, fallback = "") {
    if (!Array.isArray(list) || list.length < 1) return fallback;
    return list[this.randomInt(0, list.length - 1)] || fallback;
  }

  makeBotFirstName() {
    return this.sample(SIM_FIRST_NAMES, "Alex");
  }

  formatBotDisplayName(firstName) {
    const clean = String(firstName || "Alex")
      .replace(/[^a-zA-Z'-]/g, "")
      .slice(0, 18) || "Alex";
    return `${clean} (bot)`.slice(0, 24);
  }

  buildWsUrl(botId) {
    const sid = `${Date.now()}-${botId}-${Math.random().toString(36).slice(2, 8)}`;
    return `ws://127.0.0.1:${PORT}/?sid=${sid}`;
  }

  resetMessageMemory() {
    this.recentObservedComments = [];
    this.recentGeneratedMessages = [];
    this.generatedPhraseCounts.clear();
    this.generatedPrefixCounts.clear();
    this.botProfiles.clear();
  }

  getBotProfile(botId) {
    const key = String(botId || "");
    const known = this.botProfiles.get(key);
    if (known) return known;
    const persona = pickWeighted(SIM_PERSONAS) || SIM_PERSONAS[0];
    const profile = {
      botId: Number(botId || 0),
      persona,
      voicePrefix: this.sample(SIM_CHAT_PREFIXES, ""),
      voiceAfterthought: this.sample(SIM_CHAT_AFTERTHOUGHTS, ""),
      favoriteShort: this.sample(SIM_SHORT_REACTIONS, "wow"),
      lastNormalized: "",
      lastText: "",
    };
    this.botProfiles.set(key, profile);
    return profile;
  }

  sanitizeGeneratedText(input) {
    const compact = String(input || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!compact) return "";
    const shortened = compact.length > 92 ? compact.slice(0, 92).trimEnd() : compact;
    const clipped = sanitizeText(shortened);
    if (!clipped) return "";
    if (containsLink(clipped)) return "";
    if (containsPhoneNumber(clipped)) return "";
    if (detectModerationMatch(clipped)) return "";
    return clipped;
  }

  shortSnippet(input, maxLen = 20) {
    const raw = String(input || "")
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return "";
    if (raw.length <= maxLen) return raw;
    return raw.slice(0, Math.max(8, maxLen - 3)).trimEnd() + "...";
  }

  renderTopicLine(topic, templates = SIM_TOPIC_TEMPLATES) {
    if (!topic) return "";
    return this.sample(templates, "{topic}")
      .replace(/\{topic\}/gi, topic)
      .replace(/\s+/g, " ")
      .trim();
  }

  joinCompact(parts, separator = " ") {
    return (parts || [])
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(separator)
      .replace(/\s+/g, " ")
      .trim();
  }

  fillTemplate(template, values) {
    const rawTemplate = String(template || "");
    return rawTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      if (!values || typeof values !== "object") return "";
      return String(values[key] || "");
    });
  }

  maybeAddVoice(profile, line) {
    let out = String(line || "").replace(/\s+/g, " ").trim();
    if (!out) return "";
    if (profile && profile.voicePrefix && Math.random() < 0.16) {
      const prefix = String(profile.voicePrefix || "").trim();
      if (prefix && !out.toLowerCase().startsWith(prefix.toLowerCase())) {
        out = `${prefix}, ${out}`;
      }
    }
    if (profile && profile.voiceAfterthought && Math.random() < 0.12) {
      const tail = String(profile.voiceAfterthought || "").trim();
      if (tail) {
        const sep = /[.!?]$/.test(out) ? " " : ". ";
        out = `${out}${sep}${tail}`;
      }
    }
    return out.trim();
  }

  prefixKey(normalized) {
    const tokens = tokenizeSimText(normalized);
    if (!tokens.length) return "";
    return tokens.slice(0, 3).join(" ");
  }

  isEmojiOnlyText(input) {
    const text = String(input || "").trim();
    if (!text) return false;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    return tokens.every((token) => /^[\p{Extended_Pictographic}\uFE0F\u200D]+$/u.test(token));
  }

  observeAcceptedComment(comment) {
    if (!this.running) return;
    if (!comment || comment.type !== "comment") return;
    const text = sanitizeText(comment.text || "");
    if (!text) return;
    const name = sanitizeName(comment.name || "Anoniem");
    this.recentObservedComments.push({
      name,
      text,
      normalized: normalizeSimText(text),
      ts: Date.now(),
    });
    if (this.recentObservedComments.length > 80) {
      this.recentObservedComments.splice(0, this.recentObservedComments.length - 80);
    }
  }

  pickCallbackEntry() {
    if (!this.recentObservedComments.length) return null;
    if (Math.random() > this.config.callbackRate) return null;
    const windowSize = Math.min(24, this.recentObservedComments.length);
    const start = this.recentObservedComments.length - windowSize;
    for (let i = 0; i < 5; i += 1) {
      const entry = this.recentObservedComments[this.randomInt(start, this.recentObservedComments.length - 1)];
      if (entry && String(entry.text || "").length >= 4) return entry;
    }
    return this.recentObservedComments[this.recentObservedComments.length - 1] || null;
  }

  tonePositive() {
    const positive = clampFloat(this.config.positive, 0, 1, 0.45);
    const negative = clampFloat(this.config.negative, 0, 1, 0.7);
    return clampFloat(positive * (1 - negative * 0.92), 0, 1, positive);
  }

  toneNegative() {
    const positive = clampFloat(this.config.positive, 0, 1, 0.45);
    const negative = clampFloat(this.config.negative, 0, 1, 0.7);
    return clampFloat(negative * (0.55 + (1 - positive) * 0.45), 0, 1, negative);
  }

  personaSnip(profile) {
    const tonePositive = this.tonePositive();
    const toneNegative = this.toneNegative();
    if (toneNegative >= 0.9 && Math.random() < 0.86) {
      return this.sample(SIM_NEGATIVE_REACTIONS, "ik haak af");
    }
    if (toneNegative >= 0.65 && Math.random() < 0.55) {
      return this.sample(SIM_NEGATIVE_REACTIONS, "nee bedankt");
    }
    const persona = profile && profile.persona ? profile.persona : null;
    const personaId = String(persona && persona.id ? persona.id : "");
    const pool = [];
    if (persona && Array.isArray(persona.quickHits)) pool.push(...persona.quickHits);
    if (Array.isArray(SIM_PERSONA_SNIPS[personaId])) pool.push(...SIM_PERSONA_SNIPS[personaId]);
    if (profile && profile.favoriteShort) pool.push(profile.favoriteShort);
    if (Math.random() < toneNegative * 0.82) {
      pool.push(...SIM_NEGATIVE_REACTIONS);
    }
    if (tonePositive >= toneNegative * 0.75) {
      pool.push(...SIM_SHORT_REACTIONS);
    } else {
      pool.push(...SIM_SHORT_REACTIONS.slice(0, 20));
    }
    return this.sample(pool, this.sample(SIM_SHORT_REACTIONS, "wow"));
  }

  pickBrainrotWord() {
    if (!brainrotWords.length) return "";
    return this.sample(brainrotWords, "");
  }

  randomEmojiBurst(minCount = 1, maxCount = 4) {
    const min = clampInt(minCount, 1, 8, 1);
    const max = clampInt(maxCount, min, 8, Math.max(min, 4));
    const count = this.randomInt(min, max);
    const compact = Math.random() < 0.5;
    const out = [];
    if (Math.random() < 0.58) {
      const repeated = this.sample(SIM_EXTRA_EMOJIS, "💀");
      for (let i = 0; i < count; i += 1) out.push(repeated);
      return (compact ? out.join("") : out.join(" ")).trim();
    }
    let comboUsed = false;
    for (let i = 0; i < count; i += 1) {
      const useCombo = !comboUsed && Math.random() < 0.24;
      if (useCombo) {
        out.push(this.sample(SIM_EMOJI_COMBOS, "👁️👄👁️"));
        comboUsed = true;
      } else {
        out.push(this.sample(SIM_EXTRA_EMOJIS, "💀"));
      }
    }
    return (compact ? out.join("") : out.join(" ")).trim();
  }

  injectEmojiInside(text, emojiChunk) {
    const base = String(text || "").trim();
    const chunk = String(emojiChunk || "").trim();
    if (!base) return chunk;
    if (!chunk) return base;
    const tokens = base.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return `${chunk} ${base}`.trim();
    const index = this.randomInt(1, tokens.length - 1);
    tokens.splice(index, 0, chunk);
    return tokens.join(" ").trim();
  }

  addEmojiFlavor(text) {
    const base = String(text || "").trim();
    if (!base) return "";
    const chance = clampFloat(this.config.emojiInlineRate, 0, 1, 0.18);
    if (Math.random() > chance) return base;

    const style = Math.random();
    const emoji = this.sample(SIM_EXTRA_EMOJIS, "💀");

    if (style < 0.16) {
      return `${emoji} ${base}`.trim();
    }
    if (style < 0.9) {
      return `${base} ${emoji}`.trim();
    }
    if (style < 0.98) {
      return this.injectEmojiInside(base, emoji);
    }
    return base;
  }

  buildPersonaComboCandidate(profile, topic) {
    const persona = profile && profile.persona ? profile.persona : SIM_PERSONAS[0];
    const template = this.sample(SIM_PERSONA_COMBO_TEMPLATES, "{setup}. {close}");
    const line = this.fillTemplate(template, {
      open: this.sample(persona && persona.openers, "update"),
      setup: this.sample(persona && persona.setups, this.personaSnip(profile)),
      twist: this.sample(persona && persona.twists, "het liep anders dan gepland"),
      close: this.sample(persona && persona.closers, this.personaSnip(profile)),
    })
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) return "";

    let out = line;
    if (topic && Math.random() < 0.22) {
      out = this.joinCompact([out, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    }
    if (Math.random() < 0.18) {
      out = this.joinCompact([out, this.sample(SIM_CHAT_AFTERTHOUGHTS, "")]);
    }
    return this.maybeAddVoice(profile, out);
  }

  buildAuthenticCandidate(profile, topic, callback) {
    const prefix = this.sample(SIM_CHAT_PREFIXES, "");
    let hit = this.personaSnip(profile);
    if (callback && Math.random() < 0.34) {
      const snippet = this.shortSnippet(callback.text, 16);
      if (snippet) hit = `${this.sample(SIM_CALLBACK_LEADS, "net zei iemand")} "${snippet}"`;
    } else if (Math.random() < 0.58) {
      hit = this.sample(SIM_SHORT_REACTIONS, hit);
    }

    const line = this.fillTemplate(this.sample(SIM_AUTHENTIC_TEMPLATES, "{hit}"), {
      prefix,
      hit,
      after: this.sample(SIM_CHAT_AFTERTHOUGHTS, this.personaSnip(profile)),
      topicTail: topic ? this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS) : "",
    })
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) return "";

    let out = line;
    if (topic && Math.random() < 0.16 && !out.toLowerCase().includes(topic.toLowerCase())) {
      out = this.joinCompact([out, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    }
    if (Math.random() < 0.28) {
      out = this.joinCompact([out, this.sample(SIM_SHORT_REACTIONS, "")]);
    }
    return this.maybeAddVoice(profile, out);
  }

  buildBaseCandidate(profile, topic) {
    const tonePositive = this.tonePositive();
    const toneNegative = this.toneNegative();
    let line = this.personaSnip(profile);
    if (Math.random() < 0.56) {
      line = this.buildPersonaComboCandidate(profile, topic) || line;
    }
    if (Math.random() < 0.08 + tonePositive * 0.32) {
      line = this.joinCompact([line, this.sample(SIM_SHORT_REACTIONS, "haha")]);
    }
    if (Math.random() < 0.12 + toneNegative * 0.56) {
      line = this.joinCompact([line, this.sample(SIM_NEGATIVE_REACTIONS, "ik ben hier allergisch voor")]);
    }
    if (topic && Math.random() < 0.08 + tonePositive * 0.2 + toneNegative * 0.08) {
      line = this.joinCompact([line, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    }
    return this.maybeAddVoice(profile, line);
  }

  buildTopicCandidate(profile, topic) {
    if (!topic) return "";
    const core = this.renderTopicLine(topic, SIM_TOPIC_TEMPLATES);
    const outro = Math.random() < 0.64 ? this.sample(SIM_SHORT_REACTIONS, "") : "";
    const prefix = Math.random() < 0.22 ? this.sample(SIM_CHAT_PREFIXES, "") + "," : "";
    let line = this.joinCompact([prefix, core, outro]);
    if (Math.random() < 0.14) {
      line = this.joinCompact([line, this.sample(SIM_CHAT_AFTERTHOUGHTS, "")]);
    }
    return this.maybeAddVoice(profile, line);
  }

  buildCallbackCandidate(profile, callback, topic) {
    if (!callback) return "";
    const snippet = this.shortSnippet(callback.text, 24);
    if (!snippet) return "";
    let line =
      this.sample(SIM_CALLBACK_LEADS, "Iemand zei net") +
      ' "' +
      snippet +
      '". ' +
      this.sample(SIM_CALLBACK_PUNCHES, "Dat vat de sfeer goed samen.");
    if (topic && Math.random() < 0.22) {
      line = this.joinCompact([line, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    }
    if (Math.random() < 0.42) {
      line = this.joinCompact([line, this.personaSnip(profile)]);
    }
    return this.maybeAddVoice(profile, line);
  }

  buildAbsurdCandidate(profile, topic) {
    const toneNegative = this.toneNegative();
    const core = Math.random() < 0.12 + toneNegative * 0.58
      ? this.sample(SIM_NEGATIVE_REACTIONS, "dit sloopt mijn kalmte")
      : this.sample(SIM_ABSURD_FRAGMENTS, "ik ga stuk");
    const outro = Math.random() < 0.62 ? this.sample(SIM_SHORT_REACTIONS, "") : this.personaSnip(profile);
    let line = `${core}. ${outro}`.trim();
    if (Math.random() < 0.26) {
      line = this.joinCompact([line, this.sample(SIM_CHAT_AFTERTHOUGHTS, "")]);
    }
    if (topic && Math.random() < 0.12) {
      line = this.joinCompact([line, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    }
    return this.maybeAddVoice(profile, line);
  }

  buildNegativeCandidate(profile, topic, callback) {
    let line = this.sample(SIM_NEGATIVE_REACTIONS, "nee bedankt");
    if (callback && Math.random() < 0.26) {
      const snippet = this.shortSnippet(callback.text, 20);
      if (snippet) {
        line = `${line}. "${snippet}"`;
      }
    }
    if (topic && Math.random() < 0.22) {
      line = this.joinCompact([line, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    }
    if (Math.random() < 0.32) {
      line = this.joinCompact([line, this.sample(SIM_NEGATIVE_REACTIONS, "")]);
    }
    return this.maybeAddVoice(profile, line);
  }

  buildBrainrotCandidate(profile, topic) {
    const term = this.pickBrainrotWord();
    if (!term) return "";
    let line = this.sample(SIM_BRAINROT_REACTIONS, "{term}")
      .replace(/\{term\}/gi, term)
      .trim();
    if (Math.random() < 0.34) {
      line = this.sample(SIM_BRAINROT_RAW_DROPS, "{term}")
        .replace(/\{term\}/gi, term)
        .trim();
      return line;
    }
    if (Math.random() < 0.42) line = this.joinCompact([line, this.personaSnip(profile)]);
    if (topic && Math.random() < 0.22) line = this.joinCompact([line, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    if (Math.random() < 0.18) line = this.joinCompact([line, this.sample(SIM_CHAT_AFTERTHOUGHTS, "")]);
    return this.maybeAddVoice(profile, line);
  }

  buildEmojiOnlyCandidate() {
    const mode = Math.random();
    if (mode < 0.24) {
      return this.sample(SIM_EMOJI_COMBOS, "🗿🍷");
    }
    if (mode < 0.94) {
      const emoji = this.sample(SIM_EXTRA_EMOJIS, "💀");
      const count = this.randomInt(2, 5);
      return Array.from({ length: count }, () => emoji).join("").trim();
    }
    return this.randomEmojiBurst(2, 4);
  }

  buildQuickCandidate(profile, topic) {
    const tonePositive = this.tonePositive();
    const toneNegative = this.toneNegative();
    const favorNegativeChance = clampFloat(toneNegative * 1.05 - tonePositive * 0.35, 0, 1, 0);
    const quick = Math.random() < favorNegativeChance
      ? this.sample(SIM_NEGATIVE_REACTIONS, "meh")
      : this.sample(SIM_SHORT_REACTIONS, this.sample(SIM_SAFE_FALLBACKS, ""));
    let line = quick;
    if (Math.random() < 0.2) {
      const prefix = this.sample(SIM_CHAT_PREFIXES, "");
      line = `${prefix}, ${line}`.replace(/\s+/g, " ").trim();
    }
    if (Math.random() < (0.14 + toneNegative * 0.36)) {
      line = this.joinCompact([line, this.sample(SIM_NEGATIVE_REACTIONS, "")]);
    } else if (Math.random() < 0.24 + tonePositive * 0.2) {
      line = this.joinCompact([line, this.sample(SIM_SHORT_REACTIONS, "")]);
    }
    if (topic && Math.random() < 0.22 + tonePositive * 0.14 + toneNegative * 0.1) {
      line = this.joinCompact([line, this.renderTopicLine(topic, SIM_TOPIC_FOLLOWUPS)]);
    }
    return this.maybeAddVoice(profile, line);
  }

  buildCandidate(profile, { topic, callback }) {
    const tonePositive = this.tonePositive();
    const toneNegative = this.toneNegative();
    const choices = [
      { weight: 6 + tonePositive * 7 + toneNegative * 9, build: () => this.buildBaseCandidate(profile, topic) },
      { weight: 7 + this.config.callbackRate * 8 + tonePositive * 5 + toneNegative * 6, build: () => this.buildQuickCandidate(profile, topic) },
      { weight: 6 + toneNegative * 11 + tonePositive * 2, build: () => this.buildPersonaComboCandidate(profile, topic) },
      { weight: 6 + this.config.callbackRate * 10 + tonePositive * 4 + toneNegative * 4, build: () => this.buildAuthenticCandidate(profile, topic, callback) },
      { weight: 1 + toneNegative * 20, build: () => this.buildAbsurdCandidate(profile, topic) },
      { weight: 3 + toneNegative * 20, build: () => this.buildNegativeCandidate(profile, topic, callback) },
      {
        weight: 1 + this.config.emojiLooseRate * 20 + toneNegative * 6,
        build: () => this.buildEmojiOnlyCandidate(),
      },
    ];
    if (brainrotWords.length) {
      choices.push({
        weight: 3 + toneNegative * 16,
        build: () => this.buildBrainrotCandidate(profile, topic),
      });
    }
    if (topic) {
      choices.push({ weight: 4 + tonePositive * 4 + toneNegative * 5, build: () => this.buildTopicCandidate(profile, topic) });
    }
    if (callback) {
      choices.push({
        weight: 11 + this.config.callbackRate * 22,
        build: () => this.buildCallbackCandidate(profile, callback, topic),
      });
    }

    let total = 0;
    for (const choice of choices) {
      total += Math.max(0, Number(choice.weight) || 0);
    }
    if (total <= 0) return this.buildQuickCandidate(profile, topic);

    let r = Math.random() * total;
    for (const choice of choices) {
      r -= Math.max(0, Number(choice.weight) || 0);
      if (r <= 0) return choice.build();
    }
    return choices[choices.length - 1].build();
  }

  maxRecentSimilarity(text) {
    let best = 0;
    for (const item of this.recentGeneratedMessages) {
      const overlap = simTokenOverlap(text, item.normalized);
      if (overlap > best) best = overlap;
      if (best >= 0.98) break;
    }
    return best;
  }

  scoreCandidate(text, profile, topic, callback) {
    const normalized = normalizeSimText(text);
    if (!normalized) return -999;
    const tonePositive = this.tonePositive();
    const toneNegative = this.toneNegative();

    let score = Math.random() * 0.35;
    const tokens = tokenizeSimText(normalized);
    const len = text.length;
    score += 2.4 - Math.abs(len - 24) / 16;
    if (len > 62) score -= 1.3;
    score -= this.maxRecentSimilarity(normalized) * 5.3;
    const phraseUses = this.generatedPhraseCounts.get(normalized) || 0;
    if (phraseUses > 0) {
      score -= Math.min(6.4, phraseUses * 1.65);
    }
    const prefix = this.prefixKey(normalized);
    const prefixUses = prefix ? this.generatedPrefixCounts.get(prefix) || 0 : 0;
    if (prefixUses > 0) {
      score -= Math.min(2.4, prefixUses * 0.34);
    }
    if (tokens.length) {
      const uniqueRatio = new Set(tokens).size / tokens.length;
      score += uniqueRatio * 0.45;
      if (uniqueRatio < 0.58) score -= 0.55;
    }

    if (profile.lastNormalized) {
      score -= simTokenOverlap(normalized, profile.lastNormalized) * 2.8;
      const prevTokens = tokenizeSimText(profile.lastNormalized);
      if (tokens[0] && prevTokens[0] && tokens[0] === prevTokens[0]) score -= 0.28;
    }

    if (topic) {
      const topicTokens = tokenizeSimText(topic).filter((token) => token.length >= 3);
      let mentions = 0;
      for (const token of topicTokens) {
        if (normalized.includes(token)) mentions += 1;
      }
      if (mentions > 0) score += 0.42;
      else score -= 0.08;
    }

    if (callback && callback.normalized) {
      const callbackOverlap = simTokenOverlap(normalized, callback.normalized);
      if (callbackOverlap > 0.08) score += 0.24;
    }

    if (/[!?]/.test(text)) score += toneNegative * 0.14;
    if (toneNegative >= 0.55 && /\b(chaos|stuk|wild|lol)\b/.test(normalized)) {
      score += 0.2;
    }
    if (this.isEmojiOnlyText(text)) {
      score += 0.9 + toneNegative * 0.7 + this.config.emojiLooseRate * 4.2;
    }
    if (tonePositive >= 0.5 && tonePositive >= toneNegative && /\b(top|goud|fan|love|sterk|lekker)\b/.test(normalized)) {
      score += 0.14;
    }
    if (toneNegative >= 0.45 && /\b(haat|boos|allergisch|ramp|irritant|afkeur|matig|saai|skip|ongemakkelijk)\b/.test(normalized)) {
      score += 0.28;
    }
    if (toneNegative > tonePositive + 0.2 && /\b(top|goud|fan|love|sterk|lekker|perfect)\b/.test(normalized)) {
      score -= 0.24;
    }
    if (brainrotWordSet.has(normalized)) {
      score += 0.7;
    } else if (brainrotWordSet.size) {
      for (const term of brainrotWordSet) {
        if (term.length >= 3 && normalized.includes(term)) {
          score += 0.18;
          break;
        }
      }
    }

    return score;
  }

  rememberGenerated(botId, text) {
    const normalized = normalizeSimText(text);
    if (!normalized) return;
    this.generatedPhraseCounts.set(normalized, (this.generatedPhraseCounts.get(normalized) || 0) + 1);
    const prefix = this.prefixKey(normalized);
    if (prefix) {
      this.generatedPrefixCounts.set(prefix, (this.generatedPrefixCounts.get(prefix) || 0) + 1);
    }

    this.recentGeneratedMessages.push({ botId: Number(botId || 0), normalized, ts: Date.now() });
    if (this.recentGeneratedMessages.length > 96) {
      this.recentGeneratedMessages.splice(0, this.recentGeneratedMessages.length - 96);
    }
    if (this.generatedPhraseCounts.size > 320) {
      for (const [key, value] of this.generatedPhraseCounts.entries()) {
        if (value <= 1) this.generatedPhraseCounts.delete(key);
        else this.generatedPhraseCounts.set(key, value - 1);
        if (this.generatedPhraseCounts.size <= 260) break;
      }
    }
    if (this.generatedPrefixCounts.size > 220) {
      for (const [key, value] of this.generatedPrefixCounts.entries()) {
        if (value <= 1) this.generatedPrefixCounts.delete(key);
        else this.generatedPrefixCounts.set(key, value - 1);
        if (this.generatedPrefixCounts.size <= 170) break;
      }
    }

    const profile = this.getBotProfile(botId);
    profile.lastNormalized = normalized;
    profile.lastText = text;
  }

  makeMessage(botId, seq) {
    const profile = this.getBotProfile(botId);
    const topic = this.config.topic;
    const callback = this.pickCallbackEntry();
    const tonePositive = this.tonePositive();
    const toneNegative = this.toneNegative();
    const forcedNegativeChance = clampFloat(Math.max(0, toneNegative - tonePositive) * 0.58, 0, 0.75, 0);
    if (Math.random() < forcedNegativeChance) {
      const forcedNegative = this.sanitizeGeneratedText(this.buildNegativeCandidate(profile, topic, callback));
      if (forcedNegative) {
        this.rememberGenerated(botId, forcedNegative);
        return forcedNegative;
      }
    }
    const emojiLooseRate = clampFloat(this.config.emojiLooseRate, 0, 1, 0.7);
    const forcedEmojiChance = clampFloat(0.01 + Math.pow(emojiLooseRate, 1.8) * 0.45, 0, 0.9, 0.12);
    if (Math.random() < forcedEmojiChance) {
      const forcedEmoji = this.sanitizeGeneratedText(this.buildEmojiOnlyCandidate());
      if (forcedEmoji) {
        this.rememberGenerated(botId, forcedEmoji);
        return forcedEmoji;
      }
    }
    const candidates = new Set();
    const count = 7 + this.randomInt(0, 4);

    for (let i = 0; i < count; i += 1) {
      const candidate = this.buildCandidate(profile, { topic, callback, seq });
      if (candidate) candidates.add(candidate);
    }
    if (topic) candidates.add(this.buildTopicCandidate(profile, topic));
    if (callback) candidates.add(this.buildCallbackCandidate(profile, callback, topic));
    candidates.add(this.buildPersonaComboCandidate(profile, topic));
    candidates.add(this.buildAuthenticCandidate(profile, topic, callback));
    if (Math.random() < 0.2 + emojiLooseRate * 0.85) candidates.add(this.buildEmojiOnlyCandidate());
    if (Math.random() < emojiLooseRate * 0.7) candidates.add(this.buildEmojiOnlyCandidate());
    if (Math.random() < emojiLooseRate * 0.52) candidates.add(this.sample(SIM_EMOJI_COMBOS, "🗿🍷"));
    candidates.add(this.buildQuickCandidate(profile, topic));

    let best = "";
    let bestScore = -Infinity;
    for (const raw of candidates) {
      const safe = this.sanitizeGeneratedText(raw);
      if (!safe) continue;
      const score = this.scoreCandidate(safe, profile, topic, callback);
      if (score > bestScore) {
        bestScore = score;
        best = safe;
      }
    }

    if (!best) {
      best = this.sanitizeGeneratedText(this.sample(SIM_SAFE_FALLBACKS, "Sterke energie, we gaan door."));
    }
    if (!best) {
      for (const fallback of SIM_SAFE_FALLBACKS) {
        const safeFallback = this.sanitizeGeneratedText(fallback);
        if (safeFallback) {
          best = safeFallback;
          break;
        }
      }
    }
    if (!best) {
      best = "wow";
    }

    if (!this.isEmojiOnlyText(best)) {
      const emojiStyled = this.sanitizeGeneratedText(this.addEmojiFlavor(best));
      if (emojiStyled) best = emojiStyled;
    }

    this.rememberGenerated(botId, best);
    return best;
  }

  scheduleStopTimer() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (!this.running || this.config.durationSec <= 0) return;

    const startedTs = parseIsoTime(this.stats.startedAt) || Date.now();
    const elapsedMs = Math.max(0, Date.now() - startedTs);
    const remainingMs = this.config.durationSec * 1000 - elapsedMs;
    if (remainingMs <= 0) {
      this.stop("duration_reached");
      return;
    }
    this.stopTimer = setTimeout(() => this.stop("duration_reached"), remainingMs);
  }

  spawnBot(botId, delayMs = 0) {
    const bot = new SimulatedBotClient(botId, this);
    bot.updateNamePrefix(this.config.namePrefix);
    this.bots.push(bot);
    const delay = clampInt(delayMs, 0, 5000, 0);
    setTimeout(() => {
      if (!this.running) return;
      if (!this.bots.includes(bot)) return;
      bot.connect();
    }, delay);
    return bot;
  }

  syncClientCount(targetClients) {
    const target = clampInt(targetClients, 1, 200, this.config.clients);
    const current = this.bots.length;
    if (target > current) {
      for (let i = current; i < target; i += 1) {
        this.spawnBot(i + 1, this.config.spawnMs * (i - current));
      }
      return;
    }
    if (target < current) {
      const removed = this.bots.splice(target);
      for (const bot of removed) {
        try {
          bot.stop();
        } catch {}
      }
    }
  }

  update(rawConfig = {}) {
    const nextConfig = normalizeSimulatorConfig(rawConfig, this.config);
    this.config = nextConfig;
    for (const bot of this.bots) {
      bot.updateNamePrefix(this.config.namePrefix);
    }
    if (this.running) {
      this.syncClientCount(this.config.clients);
      this.scheduleStopTimer();
    }
    return this.getState();
  }

  start(rawConfig = {}) {
    const nextConfig = normalizeSimulatorConfig(rawConfig, this.config);
    if (this.running) this.stop("restarted");

    this.running = true;
    this.config = nextConfig;
    this.stats = createEmptySimulatorStats();
    this.stats.startedAt = nowIso();
    this.stats.stopReason = "";
    this.stats.stoppedAt = "";
    this.resetMessageMemory();
    this.bots = [];
    this.syncClientCount(this.config.clients);
    this.scheduleStopTimer();
  }

  stop(reason = "stopped") {
    if (!this.running && !this.bots.length) return;
    this.running = false;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    for (const bot of this.bots) {
      try {
        bot.stop();
      } catch {}
    }
    this.bots = [];
    this.stats.stoppedAt = nowIso();
    this.stats.stopReason = String(reason || "stopped");
    this.stats.connectedNow = 0;
  }

  getState() {
    const startedTs = parseIsoTime(this.stats.startedAt);
    const elapsedSec = startedTs ? Math.max(0, Math.floor((Date.now() - startedTs) / 1000)) : 0;
    const remainingSec =
      this.running && this.config.durationSec > 0
        ? Math.max(0, this.config.durationSec - elapsedSec)
        : null;
    return {
      running: this.running,
      config: { ...this.config },
      stats: {
        ...this.stats,
        elapsedSec,
        remainingSec,
      },
    };
  }
}

const chatSimulator = new ChatSimulatorManager();

function getAdminState() {
  cleanupEnforcementMaps();

  const accepted = sql.countAcceptedMessages.get(currentSession.id);
  const rejected = sql.countRejectedMessages.get(currentSession.id);
  const latestPoll = parsePollRow(sql.getLatestPoll.get(currentSession.id));
  const pollForState = activePoll || latestPoll;
  const pollResults = pollForState ? getPollResults(pollForState) : { counts: [], totalVotes: 0 };
  const activePollSnapshot = getPollSnapshot();

  const users = Array.from(connectedClients.values())
    .sort((a, b) => a.connectedAt.localeCompare(b.connectedAt))
    .map((client) => {
      const isBot = isSimulatorBotIdentity(client, client.name, client.clientTag);
      const targetKind = isBot ? "client" : "ip";
      const target = { clientKey: client.clientKey, ip: client.ip, targetKind };
      const mute = getMuteState(target);
      const block = getBlockState(target);
      return {
        clientId: client.clientId,
        clientKey: client.clientKey,
        clientTag: client.clientTag,
        name: client.name,
        nameColor: getNameColorHex(client.name),
        ip: client.ip,
        isBot,
        moderationTargetKind: targetKind,
        moderationTargetKey: targetKind === "client" ? client.clientKey : client.ip,
        ua: client.ua,
        connectedAt: client.connectedAt,
        isMuted: !!mute,
        mutedUntil: mute && mute.expiresAt ? mute.expiresAt : null,
        isBlocked: !!block,
        blockedUntil: block && block.expiresAt ? block.expiresAt : null,
      };
    });
  const recentMessages = sql.getRecentMessages.all(currentSession.id, 40).map((message) => ({
    ...message,
    nameColor: getNameColorHex(message && message.name ? message.name : "Anoniem"),
  }));

  const activeMutedIps = Array.from(mutedUsers.entries())
    .map(([scopeKey, state]) => {
      const scope = parseModerationScopeKey(scopeKey);
      if (!scope) return null;
      const targetKind = String((state && state.targetKind) || scope.kind || "ip");
      const targetIp = String((state && state.targetIp) || scope.ip || "");
      const targetClientKey = String((state && state.targetClientKey) || scope.clientKey || "");
      const targetKey = targetKind === "client" ? targetClientKey : targetIp;
      if (!targetKey) return null;
      const targetLabel = getClientLabel(scope) || targetKey;
      return {
        ip: targetIp || targetKey,
        targetKind,
        targetKey,
        targetIp: targetIp || null,
        targetClientKey: targetClientKey || null,
        targetLabel,
        mutedUntil: state && state.expiresAt ? String(state.expiresAt) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.targetLabel || a.targetKey).localeCompare(String(b.targetLabel || b.targetKey)));

  const activeBlockedIps = Array.from(blockedUsers.entries())
    .map(([scopeKey, state]) => {
      const scope = parseModerationScopeKey(scopeKey);
      if (!scope) return null;
      const targetKind = String((state && state.targetKind) || scope.kind || "ip");
      const targetIp = String((state && state.targetIp) || scope.ip || "");
      const targetClientKey = String((state && state.targetClientKey) || scope.clientKey || "");
      const targetKey = targetKind === "client" ? targetClientKey : targetIp;
      if (!targetKey) return null;
      const targetLabel = getClientLabel(scope) || targetKey;
      return {
        ip: targetIp || targetKey,
        targetKind,
        targetKey,
        targetIp: targetIp || null,
        targetClientKey: targetClientKey || null,
        targetLabel,
        blockedUntil: state && state.expiresAt ? String(state.expiresAt) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.targetLabel || a.targetKey).localeCompare(String(b.targetLabel || b.targetKey)));

  return {
    ok: true,
    now: nowIso(),
    runtime: {
      port: Number(PORT),
      nextPort: getSetting("next_port", String(PORT)),
      restartRequired: getSetting("next_port", String(PORT)) !== String(PORT),
      oscHost: OSC_HOST,
      oscPort: currentOscPort,
      dbPath: DB_PATH,
      pollDurationSeconds: currentPollDurationSeconds,
    },
    session: {
      id: Number(currentSession.id),
      name: currentSession.name,
      startedAt: currentSession.startedAt,
      messageCount: Number(accepted.n || 0),
      rejectedCount: Number(rejected.n || 0),
    },
    enforcement: {
      muted: activeMutedIps,
      blocked: activeBlockedIps,
    },
    users,
    simulation: chatSimulator.getState(),
    reactionCounts: reactionCountsSnapshot(reactionCounts),
    activePoll: activePollSnapshot,
    lastPoll: pollForState
      ? {
          id: pollForState.id,
          question: pollForState.question,
          options: pollForState.options,
          counts: pollResults.counts,
          totalVotes: pollResults.totalVotes,
          status: pollForState.status,
          startedAt: pollForState.startedAt,
          endedAt: pollForState.endedAt,
          durationSeconds: clampInt(pollForState.durationSeconds, 5, 3600, currentPollDurationSeconds),
        }
      : null,
    recentActions: sql.getRecentModerationActions.all(currentSession.id, 30),
    recentMessages,
  };
}

function closeSocketsForTargetIp(target, code = 4003, reason = "kicked", closeDelayMs = 0, options = {}) {
  const scope = resolveModerationScope(target, options);
  if (!scope) return 0;

  const encodedReason = String(reason || "kicked").slice(0, 120);
  const delay = clampInt(closeDelayMs, 0, 5000, 0);
  let closed = 0;
  for (const client of wss.clients) {
    const meta = client && client.__meta;
    if (!doesClientMatchScope(meta, scope)) continue;
    closed += 1;
    if (delay > 0) {
      setTimeout(() => {
        try {
          client.close(code, encodedReason);
        } catch {}
      }, delay);
    } else {
      try {
        client.close(code, encodedReason);
      } catch {}
    }
  }
  return closed;
}

function persistConnectedMeta(meta) {
  connectedClients.set(meta.clientId, {
    clientId: meta.clientId,
    clientKey: meta.clientKey,
    clientTag: meta.clientTag,
    name: meta.name,
    ip: meta.ip,
    ua: meta.ua,
    connectedAt: meta.connectedAt,
  });
}

function setMute(target, minutes, reason, createdBy) {
  const scope = resolveModerationScope(target);
  if (!scope || !scope.scopeKey) return null;
  const safeMinutes = clampInt(minutes, 1, 180, 5);
  const expiresAt = new Date(Date.now() + safeMinutes * 60 * 1000).toISOString();
  mutedUsers.set(scope.scopeKey, {
    expiresAt,
    targetKind: scope.kind,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
  });
  recordModerationAction("mute", scope.scopeKey, getClientLabel(scope), reason, expiresAt, createdBy);
  return { expiresAt, scope };
}

function clearMute(target, reason, createdBy) {
  const scope = resolveModerationScope(target);
  if (!scope || !scope.scopeKey) return null;
  mutedUsers.delete(scope.scopeKey);
  recordModerationAction("unmute", scope.scopeKey, getClientLabel(scope), reason, null, createdBy);
  return { scope };
}

function setBlock(target, reason, createdBy) {
  const scope = resolveModerationScope(target);
  if (!scope || !scope.scopeKey) return null;
  blockedUsers.set(scope.scopeKey, {
    expiresAt: null,
    targetKind: scope.kind,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
  });
  recordModerationAction("block", scope.scopeKey, getClientLabel(scope), reason, null, createdBy);
  return { scope };
}

function clearBlock(target, reason, createdBy) {
  const scope = resolveModerationScope(target);
  if (!scope || !scope.scopeKey) return null;
  blockedUsers.delete(scope.scopeKey);
  recordModerationAction("unblock", scope.scopeKey, getClientLabel(scope), reason, null, createdBy);
  return { scope };
}

if (ADMIN_PASSWORD === "admin") {
  console.log("Warning: using default ADMIN_PASSWORD. Set ADMIN_PASSWORD in env for production.");
}

rebuildEnforcementState();

function normalizeModerationText(input, { decodeLeet = false } = {}) {
  let text = String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  if (decodeLeet) {
    text = text
      .replace(/0/g, "o")
      .replace(/1/g, "i")
      .replace(/2/g, "z")
      .replace(/3/g, "e")
      .replace(/4/g, "a")
      .replace(/5/g, "s")
      .replace(/6/g, "g")
      .replace(/7/g, "t")
      .replace(/8/g, "b")
      .replace(/9/g, "g")
      .replace(/@/g, "a")
      .replace(/\$/g, "s")
      .replace(/[!|]/g, "i");
  }

  return text.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeModerationToken(input) {
  return normalizeModerationText(input).replace(/\s+/g, "");
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitTokens(text) {
  return String(text || "").split(" ").filter(Boolean);
}

function mergeSingleLetterRuns(tokens, minRunLength = 3) {
  const out = [];
  let run = [];

  function flushRun() {
    if (!run.length) return;
    if (run.length >= minRunLength) out.push(run.join(""));
    else out.push(...run);
    run = [];
  }

  for (const token of tokens) {
    if (token.length === 1) {
      run.push(token);
      continue;
    }
    flushRun();
    out.push(token);
  }
  flushRun();
  return out;
}

let moderationConfig = {
  blockedWords: [],
};
let brainrotWords = [];
let brainrotWordSet = new Set();

function parseModerationWordLines(raw) {
  return uniqueNonEmpty(
    String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
      .map((line) => normalizeModerationToken(line))
  );
}

function ensureModerationFiles() {
  try {
    fs.mkdirSync(path.dirname(MODERATION_WORDS_PATH), { recursive: true });
    if (!fs.existsSync(MODERATION_WORDS_PATH)) {
      fs.writeFileSync(MODERATION_WORDS_PATH, MODERATION_TEXT_DEFAULT);
    }
  } catch (err) {
    console.log("Moderation files init error:", err.message);
  }
}

function parseBrainrotLines(raw) {
  const terms = [];
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));

  for (const line of lines) {
    const splitParts = line.split(/[;,|]/g);
    for (const part of splitParts) {
      const clean = String(part || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 48);
      if (clean) terms.push(clean);
    }
  }

  return uniqueNonEmpty(terms);
}

function ensureBrainrotFile() {
  try {
    if (!fs.existsSync(BRAINROT_PATH)) {
      fs.writeFileSync(BRAINROT_PATH, BRAINROT_TEXT_DEFAULT);
    }
  } catch (err) {
    console.log("Brainrot file init error:", err.message);
  }
}

function loadBrainrotWords(source) {
  try {
    const raw = fs.readFileSync(BRAINROT_PATH, "utf8");
    const parsed = parseBrainrotLines(raw);
    brainrotWords = parsed;
    brainrotWordSet = new Set(parsed.map((term) => normalizeSimText(term)).filter(Boolean));
    writeDebug("brainrot_loaded", {
      source,
      words: parsed.length,
    });
  } catch (err) {
    brainrotWords = [];
    brainrotWordSet = new Set();
    writeDebug("brainrot_load_error", {
      source,
      message: err && err.message ? err.message : "unknown",
    });
  }
}

function watchBrainrotFile(filePath, source) {
  try {
    fs.watchFile(filePath, { interval: 1200 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) loadBrainrotWords(source);
    });
  } catch (err) {
    writeDebug("brainrot_watch_error", { filePath, message: err.message });
  }
}

function loadModerationFromText(source) {
  try {
    const raw = fs.readFileSync(MODERATION_WORDS_PATH, "utf8");
    const blockedWords = parseModerationWordLines(raw);

    moderationConfig = { blockedWords };
    writeDebug("moderation_loaded", {
      source,
      format: "txt",
      blockedWords: blockedWords.length,
    });
    return blockedWords.length > 0;
  } catch (err) {
    writeDebug("moderation_load_error", { source, format: "txt", message: err.message });
    return false;
  }
}

function loadModerationFromJson(source) {
  try {
    const raw = fs.readFileSync(MODERATION_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw);

    const blockedWords = uniqueNonEmpty(
      [
        ...(Array.isArray(parsed.blockedWords) ? parsed.blockedWords : []),
        ...(Array.isArray(parsed.blockedPhrases) ? parsed.blockedPhrases : []),
        ...(Array.isArray(parsed.blockedFragments) ? parsed.blockedFragments : []),
      ].map((item) => normalizeModerationToken(item))
    );

    moderationConfig = { blockedWords };
    writeDebug("moderation_loaded", {
      source,
      format: "json",
      blockedWords: blockedWords.length,
    });
    return blockedWords.length > 0;
  } catch (err) {
    writeDebug("moderation_load_error", { source, format: "json", message: err.message });
    return false;
  }
}

function loadModerationData(source) {
  const loadedFromText = loadModerationFromText(source);
  if (loadedFromText) return;

  // Backward compatibility: if txt is missing/empty, use the old JSON structure.
  loadModerationFromJson(`${source}_json_fallback`);
}

function watchModerationFile(filePath, source) {
  try {
    fs.watchFile(filePath, { interval: 1200 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) loadModerationData(source);
    });
  } catch (err) {
    writeDebug("moderation_watch_error", { filePath, message: err.message });
  }
}

function detectModerationMatch(input, { allowSubword = false } = {}) {
  const textPlain = normalizeModerationText(input);
  if (!textPlain) return null;

  const textLeet = normalizeModerationText(input, { decodeLeet: true });

  const plainTokens = splitTokens(textPlain);
  const leetTokens = splitTokens(textLeet);
  const mergedPlainTokens = mergeSingleLetterRuns(plainTokens);
  const mergedLeetTokens = mergeSingleLetterRuns(leetTokens);

  const tokenSet = new Set([
    ...plainTokens,
    ...leetTokens,
    ...mergedPlainTokens,
    ...mergedLeetTokens,
  ]);

  const compactForms = uniqueNonEmpty([
    plainTokens.join(""),
    leetTokens.join(""),
    mergedPlainTokens.join(""),
    mergedLeetTokens.join(""),
  ]);

  for (const blocked of moderationConfig.blockedWords) {
    if (tokenSet.has(blocked)) return { type: "word", match: blocked };
    if (allowSubword && blocked.length >= 4) {
      for (const compact of compactForms) {
        if (compact.includes(blocked)) return { type: "subword", match: blocked };
      }
    }
  }

  return null;
}

function normalizeForContactCheck(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\(\s*dot\s*\)|\[\s*dot\s*\]|\{\s*dot\s*\}/g, ".")
    .replace(/\(\s*punt\s*\)|\[\s*punt\s*\]|\{\s*punt\s*\}/g, ".")
    .replace(/\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\}/g, "@");
}

function containsLink(input) {
  const raw = String(input || "");
  if (!raw.trim()) return false;

  const normalized = normalizeForContactCheck(raw);
  const compact = normalized.replace(/\s+/g, "");

  if (DIRECT_LINK_RE.test(raw) || DIRECT_LINK_RE.test(normalized) || DIRECT_LINK_RE.test(compact)) {
    return true;
  }
  if (LINK_SHORTENER_RE.test(raw) || LINK_SHORTENER_RE.test(normalized) || LINK_SHORTENER_RE.test(compact)) {
    return true;
  }
  if (DOMAIN_RE.test(raw) || DOMAIN_RE.test(normalized) || DOMAIN_RE.test(compact)) {
    return true;
  }
  return false;
}

function containsPhoneNumber(input) {
  const raw = String(input || "");
  if (!raw.trim()) return false;

  const normalized = normalizeForContactCheck(raw)
    .replace(/[o]/g, "0")
    .replace(/[il]/g, "1");
  const candidates = normalized.match(PHONE_CANDIDATE_RE) || [];

  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return true;
  }

  const compact = normalized.replace(/[^\d+]/g, "");
  const compactDigits = compact.replace(/\D/g, "");
  if (compactDigits.length >= 10 && compactDigits.length <= 15 && /^\+?\d{10,15}$/.test(compact)) {
    return true;
  }

  return false;
}

ensureModerationFiles();
loadModerationData("startup");
watchModerationFile(MODERATION_WORDS_PATH, "watch_txt");
watchModerationFile(MODERATION_JSON_PATH, "watch_json");
ensureBrainrotFile();
loadBrainrotWords("startup");
watchBrainrotFile(BRAINROT_PATH, "watch_brainrot");

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/debug-log", (req, res) => {
  const requested = Number.parseInt(String(req.query.lines || "120"), 10);
  const lineCount = Number.isFinite(requested)
    ? Math.max(20, Math.min(400, requested))
    : 120;

  fs.readFile(DEBUG_LOG_PATH, "utf8", (err, text) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.json({ ok: true, lines: [] });
        return;
      }
      res.status(500).json({ ok: false, error: "debug log read failed" });
      return;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    res.json({ ok: true, lines: lines.slice(-lineCount) });
  });
});

app.post("/client-debug", (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = { note: body };
    }
  }
  if (!body || typeof body !== "object") body = {};

  const note = String(body.note || "").slice(0, 320);
  const clientTag = String(body.clientTag || "").slice(0, 80);
  const state = String(body.state || "").slice(0, 120);

  if (note) {
    writeDebug("client_debug_http", { ip, ua, clientTag, state, note });
  }
  res.status(204).end();
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.post("/admin/login", (req, res) => {
  const ip = normalizeIp(req.socket.remoteAddress || "unknown");
  const provided = String((req.body && req.body.password) || "");
  if (!provided || provided !== ADMIN_PASSWORD) {
    writeDebug("admin_login_failed", { ip });
    res.status(401).json({ ok: false, error: "invalid_credentials" });
    return;
  }

  const rememberDevice = isTruthy(req.body && req.body.rememberDevice);
  const deviceLabel =
    sanitizeDeviceLabel(req.body && req.body.deviceLabel) ||
    sanitizeDeviceLabel(req.headers["user-agent"] || "");
  if (rememberDevice) {
    const trusted = issueTrustedAdminDeviceRecord({ ip, label: deviceLabel });
    setTrustedAdminDeviceCookie(res, req, trusted.rawToken, trusted.expiresAt);
  } else {
    revokeTrustedAdminDeviceByRequest(req);
    clearTrustedAdminDeviceCookie(res, req);
  }

  const token = issueAdminToken();
  writeDebug("admin_login_ok", { ip, rememberedDevice: rememberDevice });
  res.json({ ok: true, token, expiresInMs: ADMIN_SESSION_TTL_MS, rememberedDevice: rememberDevice });
});

app.post("/admin/login/device", (req, res) => {
  const ip = normalizeIp(req.socket.remoteAddress || "unknown");
  const trusted = getTrustedAdminDeviceFromRequest(req);
  if (!trusted) {
    clearTrustedAdminDeviceCookie(res, req);
    writeDebug("admin_login_device_failed", { ip });
    res.status(401).json({ ok: false, error: "device_not_trusted" });
    return;
  }

  const rotated = rotateTrustedAdminDeviceRecord(trusted.row, { ip });
  setTrustedAdminDeviceCookie(res, req, rotated.rawToken, rotated.expiresAt);
  const token = issueAdminToken();
  writeDebug("admin_login_device_ok", { ip, trustedDeviceId: Number(trusted.row.id) });
  res.json({ ok: true, token, expiresInMs: ADMIN_SESSION_TTL_MS, rememberedDevice: true });
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  const forgetDevice = isTruthy(req.body && req.body.forgetDevice);
  adminTokens.delete(req.adminToken);
  if (forgetDevice) {
    revokeTrustedAdminDeviceByRequest(req);
    clearTrustedAdminDeviceCookie(res, req);
  }
  res.json({ ok: true, forgotDevice: forgetDevice });
});

app.post("/admin/restart", requireAdmin, (req, res) => {
  const confirm = isTruthy(req.body && req.body.confirm);
  if (!confirm) {
    res.status(400).json({ ok: false, error: "confirm_required" });
    return;
  }
  try {
    const restart = requestServerRestart("admin");
    res.json({
      ok: true,
      restartPending: true,
      alreadyPending: !!restart.alreadyPending,
      reconnectAfterMs: Number(restart.childBootDelayMs || ADMIN_RESTART_CHILD_BOOT_DELAY_MS) + 800,
    });
  } catch (err) {
    writeDebug("server_restart_failed", {
      by: "admin",
      message: err && err.message ? err.message : "unknown",
    });
    res.status(500).json({ ok: false, error: "restart_failed" });
  }
});

app.get("/admin/state", requireAdmin, (req, res) => {
  res.json(getAdminState());
});

app.get("/admin/user-history", requireAdmin, (req, res) => {
  const scope = resolveModerationScope(
    {
      ip: String(req.query.ip || ""),
      clientKey: String(req.query.clientKey || ""),
      targetKind: String(req.query.targetKind || ""),
    },
    { kind: String(req.query.targetKind || "") }
  );
  if (!scope) {
    res.status(400).json({ ok: false, error: "ip_or_clientKey_required" });
    return;
  }

  const limit = clampInt(req.query.limit, 10, 200, 80);
  const rows = scope.kind === "client"
    ? sql.getRecentMessagesByClientKey.all(currentSession.id, scope.clientKey, limit)
    : sql.getRecentMessagesByIp.all(currentSession.id, scope.ip, limit);
  res.json({
    ok: true,
    sessionId: Number(currentSession.id),
    targetKind: scope.kind,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
    messages: rows,
  });
});

app.post("/admin/session/new", requireAdmin, (req, res) => {
  const confirm = !!(req.body && req.body.confirm);
  if (!confirm) {
    res.status(400).json({ ok: false, error: "confirm_required" });
    return;
  }

  const newSession = beginNewSession(req.body && req.body.name, "admin");
  writeDebug("session_started", {
    by: "admin",
    sessionId: newSession.id,
    sessionName: newSession.name,
  });

  for (const client of wss.clients) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          safeJsonStringify({
            type: "session_reset",
            message: "Nieuwe sessie gestart. Verbind opnieuw.",
          })
        );
      }
    } catch {}
    try {
      client.close(4010, "new session");
    } catch {}
  }

  res.json({
    ok: true,
    session: {
      id: Number(newSession.id),
      name: newSession.name,
      startedAt: newSession.startedAt,
    },
  });
});

app.post("/admin/users/mute", requireAdmin, (req, res) => {
  const scope = resolveModerationScope(
    {
      clientKey: String((req.body && req.body.clientKey) || ""),
      ip: String((req.body && req.body.ip) || ""),
      targetKind: String((req.body && req.body.targetKind) || ""),
    },
    { kind: String((req.body && req.body.targetKind) || "") }
  );
  if (!scope) {
    res.status(400).json({ ok: false, error: "clientKey_required" });
    return;
  }
  const minutes = clampInt(req.body && req.body.minutes, 1, 180, 5);
  const reason = String((req.body && req.body.reason) || "").slice(0, 200);
  const muteResult = setMute(scope, minutes, reason, "admin");
  const expiresAt = muteResult && muteResult.expiresAt ? String(muteResult.expiresAt) : null;
  const remainingMs = Math.max(0, Date.parse(expiresAt || "") - Date.now());
  const notified = sendToTargetIp(scope, {
    type: "moderation_notice",
    code: "user_muted",
    message: "Je bent tijdelijk gemute door de moderator.",
    mutedUntil: expiresAt || null,
    remainingMs,
  });
  const targetKey = scope.kind === "client" ? scope.clientKey : scope.ip;
  writeDebug("user_muted", { targetKind: scope.kind, targetKey, minutes, expiresAt });
  publishModerationFeedNotice("mute", scope, { minutes, expiresAt });
  res.json({
    ok: true,
    targetKind: scope.kind,
    targetKey,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
    mutedUntil: expiresAt,
    notified,
  });
});

app.post("/admin/users/unmute", requireAdmin, (req, res) => {
  const scope = resolveModerationScope(
    {
      clientKey: String((req.body && req.body.clientKey) || ""),
      ip: String((req.body && req.body.ip) || ""),
      targetKind: String((req.body && req.body.targetKind) || ""),
    },
    { kind: String((req.body && req.body.targetKind) || "") }
  );
  if (!scope) {
    res.status(400).json({ ok: false, error: "clientKey_required" });
    return;
  }
  const reason = String((req.body && req.body.reason) || "").slice(0, 200);
  clearMute(scope, reason, "admin");
  const notified = sendToTargetIp(scope, {
    type: "moderation_notice",
    code: "user_unmuted",
    message: "Je mute is opgeheven. Je kunt weer reageren.",
  });
  const targetKey = scope.kind === "client" ? scope.clientKey : scope.ip;
  writeDebug("user_unmuted", { targetKind: scope.kind, targetKey });
  publishModerationFeedNotice("unmute", scope, {});
  res.json({
    ok: true,
    targetKind: scope.kind,
    targetKey,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
    notified,
  });
});

app.post("/admin/users/block", requireAdmin, (req, res) => {
  const scope = resolveModerationScope(
    {
      clientKey: String((req.body && req.body.clientKey) || ""),
      ip: String((req.body && req.body.ip) || ""),
      targetKind: String((req.body && req.body.targetKind) || ""),
    },
    { kind: String((req.body && req.body.targetKind) || "") }
  );
  if (!scope) {
    res.status(400).json({ ok: false, error: "clientKey_required" });
    return;
  }
  const reason = String((req.body && req.body.reason) || "").slice(0, 200);
  setBlock(scope, reason, "admin");
  const notified = sendToTargetIp(scope, {
    type: "moderation_notice",
    code: "user_blocked",
    message: "Je bent geblokkeerd door de moderator en wordt verwijderd.",
  });
  publishModerationFeedNotice("block", scope, {});
  const closed = closeSocketsForTargetIp(scope, 4004, "blocked", 120);
  const targetKey = scope.kind === "client" ? scope.clientKey : scope.ip;
  writeDebug("user_blocked", { targetKind: scope.kind, targetKey, closed });
  res.json({
    ok: true,
    targetKind: scope.kind,
    targetKey,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
    closed,
    notified,
  });
});

app.post("/admin/users/unblock", requireAdmin, (req, res) => {
  const scope = resolveModerationScope(
    {
      clientKey: String((req.body && req.body.clientKey) || ""),
      ip: String((req.body && req.body.ip) || ""),
      targetKind: String((req.body && req.body.targetKind) || ""),
    },
    { kind: String((req.body && req.body.targetKind) || "") }
  );
  if (!scope) {
    res.status(400).json({ ok: false, error: "clientKey_required" });
    return;
  }
  const reason = String((req.body && req.body.reason) || "").slice(0, 200);
  clearBlock(scope, reason, "admin");
  const targetKey = scope.kind === "client" ? scope.clientKey : scope.ip;
  writeDebug("user_unblocked", { targetKind: scope.kind, targetKey });
  publishModerationFeedNotice("unblock", scope, {});
  res.json({
    ok: true,
    targetKind: scope.kind,
    targetKey,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
  });
});

app.post("/admin/users/kick", requireAdmin, (req, res) => {
  const scope = resolveModerationScope(
    {
      clientKey: String((req.body && req.body.clientKey) || ""),
      ip: String((req.body && req.body.ip) || ""),
      targetKind: String((req.body && req.body.targetKind) || ""),
    },
    { kind: String((req.body && req.body.targetKind) || "") }
  );
  if (!scope) {
    res.status(400).json({ ok: false, error: "clientKey_required" });
    return;
  }
  const reason = String((req.body && req.body.reason) || "moderator").slice(0, 120);
  const notified = sendToTargetIp(scope, {
    type: "moderation_notice",
    code: "kicked",
    message: "Je bent verwijderd door de moderator.",
  });
  const closed = closeSocketsForTargetIp(scope, 4003, "kicked", 80);
  recordModerationAction("kick", scope.scopeKey, getClientLabel(scope), reason, null, "admin");
  const targetKey = scope.kind === "client" ? scope.clientKey : scope.ip;
  writeDebug("user_kicked", { targetKind: scope.kind, targetKey, closed });
  res.json({
    ok: true,
    targetKind: scope.kind,
    targetKey,
    targetIp: scope.ip || null,
    targetClientKey: scope.clientKey || null,
    closed,
    notified,
  });
});

app.post("/admin/polls/start", requireAdmin, (req, res) => {
  const rawQuestion = String((req.body && req.body.question) || "").trim();
  const question = rawQuestion.slice(0, 180);
  const requestedDurationSeconds = clampInt(
    req.body && req.body.durationSeconds,
    5,
    3600,
    currentPollDurationSeconds
  );
  let options = [];

  if (Array.isArray(req.body && req.body.options)) {
    options = req.body.options.map((item) => String(item || "").trim()).filter(Boolean);
  } else {
    const fromText = String((req.body && req.body.optionsText) || "");
    options = fromText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  options = options.map((item) => item.slice(0, 80)).filter(Boolean);
  options = Array.from(new Set(options));
  if (!question) {
    res.status(400).json({ ok: false, error: "question_required" });
    return;
  }
  if (options.length < 2 || options.length > 6) {
    res.status(400).json({ ok: false, error: "options_invalid" });
    return;
  }

  if (activePoll) {
    const closedPollId = activePoll.id;
    if (closeActivePoll("replaced", "admin")) {
      broadcastToClients({ type: "poll_closed", pollId: closedPollId });
    }
  }

  const insert = sql.insertPoll.run(
    currentSession.id,
    question,
    safeJsonStringify(options, "[]"),
    requestedDurationSeconds,
    nowIso(),
    "admin"
  );
  currentPollDurationSeconds = requestedDurationSeconds;
  setSetting("poll_duration_seconds", String(currentPollDurationSeconds));
  activePoll = parsePollRow(sql.getActivePoll.get(currentSession.id));
  scheduleActivePollAutoClose();
  const pollSnapshot = getPollSnapshot();
  writeDebug("poll_started", {
    pollId: Number(insert.lastInsertRowid),
    question,
    optionCount: options.length,
    durationSeconds: requestedDurationSeconds,
  });
  broadcastToClients({ type: "poll_started", poll: pollSnapshot });
  res.json({ ok: true, poll: pollSnapshot });
});

app.post("/admin/polls/close", requireAdmin, (req, res) => {
  if (!activePoll) {
    res.status(400).json({ ok: false, error: "no_active_poll" });
    return;
  }
  const pollId = activePoll.id;
  closeActivePoll("admin_close", "admin");
  broadcastToClients({ type: "poll_closed", pollId });
  res.json({ ok: true, pollId });
});

function parseSimConfigFromBody(body) {
  const src = body || {};
  return {
    clients: src.clients,
    durationSec: src.durationSec,
    msgRate: src.msgRate,
    reactionRate: src.reactionRate,
    emojiInlineRate: src.emojiInlineRate,
    emojiLooseRate: src.emojiLooseRate,
    spawnMs: src.spawnMs,
    minGapMs: src.minGapMs,
    autoVote: src.autoVote,
    pollVoteChance: src.pollVoteChance,
    voteDelayMinMs: src.voteDelayMinMs,
    voteDelayMaxMs: src.voteDelayMaxMs,
    namePrefix: src.namePrefix,
    topic: src.topic,
    positive: src.positive,
    negative: src.negative,
    sarcasm: src.sarcasm,
    absurdity: src.absurdity,
    callbackRate: src.callbackRate,
  };
}

app.post("/admin/sim/start", requireAdmin, (req, res) => {
  const config = parseSimConfigFromBody(req.body);
  chatSimulator.start(config);
  const state = chatSimulator.getState();
  writeDebug("sim_started", {
    clients: state.config.clients,
    durationSec: state.config.durationSec,
    msgRate: state.config.msgRate,
    reactionRate: state.config.reactionRate,
    emojiInlineRate: state.config.emojiInlineRate,
    emojiLooseRate: state.config.emojiLooseRate,
    topic: state.config.topic,
    positive: state.config.positive,
    negative: state.config.negative,
    callbackRate: state.config.callbackRate,
  });
  res.json({ ok: true, simulation: state });
});

app.post("/admin/sim/update", requireAdmin, (req, res) => {
  const config = parseSimConfigFromBody(req.body);
  const state = chatSimulator.update(config);
  writeDebug("sim_updated", {
    running: state.running,
    clients: state.config.clients,
    durationSec: state.config.durationSec,
    msgRate: state.config.msgRate,
    reactionRate: state.config.reactionRate,
    emojiInlineRate: state.config.emojiInlineRate,
    emojiLooseRate: state.config.emojiLooseRate,
    topic: state.config.topic,
    positive: state.config.positive,
    negative: state.config.negative,
    callbackRate: state.config.callbackRate,
  });
  res.json({ ok: true, simulation: state });
});

app.post("/admin/sim/defaults", requireAdmin, (req, res) => {
  const config = parseSimConfigFromBody(req.body);
  const defaults = saveSimulatorDefaults(config);
  const state = chatSimulator.update(defaults);
  writeDebug("sim_defaults_saved", {
    running: state.running,
    clients: defaults.clients,
    durationSec: defaults.durationSec,
    msgRate: defaults.msgRate,
    reactionRate: defaults.reactionRate,
    emojiInlineRate: defaults.emojiInlineRate,
    emojiLooseRate: defaults.emojiLooseRate,
    topic: defaults.topic,
    positive: defaults.positive,
    negative: defaults.negative,
    callbackRate: defaults.callbackRate,
  });
  res.json({ ok: true, defaults, simulation: state });
});

app.post("/admin/sim/stop", requireAdmin, (req, res) => {
  const reason = String((req.body && req.body.reason) || "admin_stop").slice(0, 120);
  chatSimulator.stop(reason);
  writeDebug("sim_stopped", { reason });
  res.json({ ok: true, simulation: chatSimulator.getState() });
});

app.post("/admin/settings/port", requireAdmin, (req, res) => {
  const port = clampInt(req.body && req.body.port, 1, 65535, -1);
  if (port < 1) {
    res.status(400).json({ ok: false, error: "invalid_port" });
    return;
  }
  setSetting("next_port", String(port));
  writeDebug("port_setting_changed", { nextPort: port, by: "admin" });
  res.json({
    ok: true,
    nextPort: port,
    runtimePort: Number(PORT),
    restartRequired: String(port) !== String(PORT),
  });
});

app.post("/admin/settings/osc-port", requireAdmin, (req, res) => {
  const port = clampInt(req.body && req.body.port, 1, 65535, -1);
  if (port < 1) {
    res.status(400).json({ ok: false, error: "invalid_port" });
    return;
  }
  currentOscPort = port;
  setSetting("osc_port", String(currentOscPort));
  writeDebug("osc_port_changed", { oscHost: OSC_HOST, oscPort: currentOscPort, by: "admin" });
  res.json({
    ok: true,
    oscHost: OSC_HOST,
    oscPort: currentOscPort,
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  // Safari/iOS can be picky with compressed WS frames during reconnect churn.
  perMessageDeflate: false,
});
let nextClientId = 1;
scheduleActivePollAutoClose();

server.on("upgrade", (req, socket) => {
  const ip = normalizeIp(socket.remoteAddress || "unknown");
  const ua = req.headers["user-agent"] || "unknown";
  writeDebug("http_upgrade", {
    ip,
    ua,
    url: req.url || "/",
    host: req.headers.host || "",
    upgrade: req.headers.upgrade || "",
    connection: req.headers.connection || "",
  });
});

function sanitizeText(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (text.length > 140) return text.slice(0, 140);
  return text;
}

function sanitizeName(input) {
  const name = String(input || "").trim().replace(/\s+/g, " ");
  if (!name) return "Anoniem";
  if (name.length > 24) return name.slice(0, 24);
  return name;
}

function isBotDisplayName(name) {
  return /\(bot\)\s*$/i.test(String(name || "").trim());
}

function isSimulatorClientTag(tag) {
  return sanitizeClientTag(tag).startsWith("sim");
}

function isSimulatorBotIdentity(meta, name = "", clientTag = "") {
  const resolvedName = sanitizeName(name || (meta && meta.name) || "");
  const resolvedTag = sanitizeClientTag(clientTag || (meta && meta.clientTag) || "");
  return isSimulatorClientTag(resolvedTag) && isBotDisplayName(resolvedName);
}

const rateMap = new Map();
/* max 1 message per 2 seconds per client */
function allowMessage(key) {
  const t = Date.now();
  const last = rateMap.get(key) || 0;
  if (t - last < 2000) return false;
  rateMap.set(key, t);
  return true;
}

const reactionRateMap = new Map();
/* reactions are spammable, but keep a light cap to avoid accidental floods */
function allowReaction(key) {
  const t = Date.now();
  const last = reactionRateMap.get(key) || 0;
  if (t - last < 120) return false;
  reactionRateMap.set(key, t);
  return true;
}

wss.on("connection", (ws, req) => {
  const clientId = nextClientId++;
  const ip = normalizeIp(req.socket.remoteAddress || "unknown");
  const ua = req.headers["user-agent"] || "unknown";
  const connectedAt = nowIso();
  const meta = {
    clientId,
    ip,
    ua,
    connectedAt,
    clientTag: "anon",
    name: "Anoniem",
    clientKey: buildClientKey(ip, "anon"),
  };
  ws.__meta = meta;
  persistConnectedMeta(meta);

  console.log("WS connected:", ip);
  writeDebug("ws_connected", { clientId, ip, ua });

  const initialBlockState = getBlockState(meta);
  if (initialBlockState) {
    connectedClients.delete(clientId);
    try {
      ws.send(
        safeJsonStringify({
          type: "error",
          code: "user_blocked",
          message: "Je bent geblokkeerd door de moderator.",
        })
      );
    } catch {}
    try {
      ws.close(4004, "blocked");
    } catch {}
    writeDebug("ws_rejected_blocked", { clientId, ip });
    return;
  }

  ws.send(
    safeJsonStringify({
      type: "hello",
      time: nowIso(),
      sessionId: Number(currentSession.id),
    })
  );

  const pollSnapshot = getPollSnapshot();
  if (pollSnapshot) {
    ws.send(safeJsonStringify({ type: "poll_started", poll: pollSnapshot }));
  }

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      writeDebug("ws_bad_json", { clientId, ip, raw: data.toString().slice(0, 120) });
      return;
    }

    if (msg.type === "register") {
      const nextTag = sanitizeClientTag(msg.clientTag);
      const nextName = sanitizeName(msg.name);
      const isSimulatorBot = isSimulatorBotIdentity(meta, nextName, nextTag);
      meta.clientTag = nextTag;
      if (nextName) {
        if (isSimulatorBot) {
          meta.name = nextName;
        } else {
          const blockedByLink = containsLink(nextName);
          const blockedByPhone = containsPhoneNumber(nextName);
          const blockedByWord = detectModerationMatch(nextName, { allowSubword: true });
          if (blockedByLink) {
            ws.send(
              safeJsonStringify({
                type: "error",
                code: "name_link_blocked",
                message: "Gebruikersnaam mag geen links bevatten.",
              })
            );
          } else if (blockedByPhone) {
            ws.send(
              safeJsonStringify({
                type: "error",
                code: "name_phone_blocked",
                message: "Gebruikersnaam mag geen telefoonnummers bevatten.",
              })
            );
          } else if (blockedByWord) {
            ws.send(
              safeJsonStringify({
                type: "error",
                code: "name_blocked",
                message: "Gebruikersnaam bevat ongewenst taalgebruik.",
              })
            );
          } else {
            meta.name = nextName;
          }
        }
      }
      meta.clientKey = buildClientKey(meta.ip, nextTag);
      persistConnectedMeta(meta);
      writeDebug("ws_registered", {
        clientId,
        ip,
        clientTag: meta.clientTag,
        clientKey: meta.clientKey,
        name: meta.name,
      });
      return;
    }

    if (msg.type === "client_debug") {
      const note = String(msg.note || "").slice(0, 240);
      writeDebug("client_debug", { clientId, ip, note });
      return;
    }

    if (msg.type === "ping") {
      writeDebug("ws_ping", { clientId, ip });
      try {
        ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
        writeDebug("ws_pong_sent", { clientId, ip });
      } catch {}
      return;
    }

    if (msg.type === "reaction") {
      const reaction = normalizeReactionType(msg.reaction);
      if (!reaction) return;

      meta.clientTag = sanitizeClientTag(msg.clientTag || meta.clientTag);
      meta.clientKey = buildClientKey(meta.ip, meta.clientTag);
      persistConnectedMeta(meta);

      const blockState = getBlockState(meta);
      if (blockState) {
        ws.send(
          safeJsonStringify({
            type: "error",
            code: "user_blocked",
            message: "Je bent geblokkeerd door de moderator.",
          })
        );
        return;
      }

      const muteState = getMuteState(meta);
      if (muteState) {
        const muteUntilTs = parseIsoTime(muteState.expiresAt);
        const remainingMs = muteUntilTs ? Math.max(0, muteUntilTs - Date.now()) : null;
        ws.send(
          safeJsonStringify({
            type: "error",
            code: "user_muted",
            message: "Je bent tijdelijk gemute.",
            mutedUntil: muteState.expiresAt || null,
            remainingMs,
          })
        );
        return;
      }

      if (!allowReaction(meta.clientKey)) return;
      reactionCounts[reaction] = Number(reactionCounts[reaction] || 0) + 1;
      const counts = reactionCountsSnapshot(reactionCounts);
      const total = Number(counts[reaction] || 0);
      writeDebug("reaction_received", { clientId, ip, clientKey: meta.clientKey, reaction, total });
      sendOsc("/reaction/type", [{ type: "s", value: reaction }], { clientId, ip, channel: "reaction_type" });
      sendOsc("/reaction/heart", [{ type: "i", value: Number(counts.heart || 0) }], {
        clientId,
        ip,
        channel: "reaction_heart",
      });
      sendOsc("/reaction/fire", [{ type: "i", value: Number(counts.fire || 0) }], {
        clientId,
        ip,
        channel: "reaction_fire",
      });
      sendOsc("/reaction/laugh", [{ type: "i", value: Number(counts.laugh || 0) }], {
        clientId,
        ip,
        channel: "reaction_laugh",
      });
      sendOsc("/reaction/bored", [{ type: "i", value: Number(counts.bored || 0) }], {
        clientId,
        ip,
        channel: "reaction_bored",
      });
      return;
    }

    if (msg.type === "poll_vote") {
      if (!activePoll) return;
      const optionIndex = Number.parseInt(String(msg.optionIndex), 10);
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= activePoll.options.length) {
        ws.send(
          safeJsonStringify({
            type: "error",
            code: "poll_vote_invalid",
            message: "Ongeldige poll-optie.",
          })
        );
        return;
      }

      const clientTagFromMsg = sanitizeClientTag(msg.clientTag || meta.clientTag);
      meta.clientTag = clientTagFromMsg;
      meta.clientKey = buildClientKey(meta.ip, clientTagFromMsg);
      persistConnectedMeta(meta);

      const blockState = getBlockState(meta);
      if (blockState) {
        ws.send(
          safeJsonStringify({
            type: "error",
            code: "user_blocked",
            message: "Je bent geblokkeerd door de moderator.",
          })
        );
        return;
      }

      const muteState = getMuteState(meta);
      if (muteState) {
        const muteUntilTs = parseIsoTime(muteState.expiresAt);
        const remainingMs = muteUntilTs ? Math.max(0, muteUntilTs - Date.now()) : null;
        ws.send(
          safeJsonStringify({
            type: "error",
            code: "user_muted",
            message: "Je bent tijdelijk gemute.",
            mutedUntil: muteState.expiresAt || null,
            remainingMs,
          })
        );
        return;
      }

      const voteInsert = sql.insertPollVoteIfNew.run(activePoll.id, meta.clientKey, optionIndex, nowIso());
      if (!Number(voteInsert.changes || 0)) {
        ws.send(
          safeJsonStringify({
            type: "error",
            code: "poll_vote_locked",
            message: "Je stem is al opgeslagen.",
          })
        );
        return;
      }

      writeDebug("poll_vote", { pollId: activePoll.id, clientId, clientKey: meta.clientKey, optionIndex });
      ws.send(safeJsonStringify({ type: "poll_vote_ok", pollId: activePoll.id, optionIndex }));
      broadcastPollUpdate();
      return;
    }

    if (msg.type !== "comment") return;

    meta.clientTag = sanitizeClientTag(msg.clientTag || meta.clientTag);
    meta.clientKey = buildClientKey(meta.ip, meta.clientTag);

    const name = sanitizeName(msg.name || meta.name);
    const text = sanitizeText(msg.text);
    if (!text) return;
    const isSimulatorBot = isSimulatorBotIdentity(meta, name, meta.clientTag);
    meta.name = name || meta.name;
    persistConnectedMeta(meta);

    function rejectComment(code, message, status, detail = "") {
      ws.send(
        safeJsonStringify({
          type: "error",
          code,
          message,
        })
      );
      recordChatMessage({
        clientId,
        clientKey: meta.clientKey,
        ip,
        name,
        text,
        status,
        detail,
      });
    }

    const blockState = getBlockState(meta);
    if (blockState) {
      rejectComment("user_blocked", "Je bent geblokkeerd door de moderator.", "blocked_user", "blocked");
      writeDebug("comment_blocked_user", { clientId, ip, targetIp: meta.ip, clientKey: meta.clientKey });
      return;
    }

    const muteState = getMuteState(meta);
    if (muteState) {
      const muteUntilTs = parseIsoTime(muteState.expiresAt);
      const remainingMs = muteUntilTs ? Math.max(0, muteUntilTs - Date.now()) : null;
      ws.send(
        safeJsonStringify({
          type: "error",
          code: "user_muted",
          message: "Je bent tijdelijk gemute.",
          mutedUntil: muteState.expiresAt || null,
          remainingMs,
        })
      );
      recordChatMessage({
        clientId,
        clientKey: meta.clientKey,
        ip,
        name,
        text,
        status: "muted_user",
        detail: muteState.expiresAt || "",
      });
      writeDebug("comment_muted_user", {
        clientId,
        ip,
        targetIp: meta.ip,
        clientKey: meta.clientKey,
        mutedUntil: muteState.expiresAt || null,
      });
      return;
    }

    if (!isSimulatorBot) {
      if (containsLink(name)) {
        rejectComment("name_link_blocked", "Gebruikersnaam mag geen links bevatten.", "blocked_name_link", "name link");
        writeDebug("contact_blocked", { clientId, ip, field: "name", rule: "link" });
        return;
      }

      if (containsPhoneNumber(name)) {
        rejectComment(
          "name_phone_blocked",
          "Gebruikersnaam mag geen telefoonnummers bevatten.",
          "blocked_name_phone",
          "name phone"
        );
        writeDebug("contact_blocked", { clientId, ip, field: "name", rule: "phone" });
        return;
      }

      const nameMatch = detectModerationMatch(name, { allowSubword: true });
      if (nameMatch) {
        rejectComment("name_blocked", "Gebruikersnaam bevat ongewenst taalgebruik.", "blocked_name_word", nameMatch.match);
        writeDebug("moderation_blocked", {
          clientId,
          ip,
          field: "name",
          matchType: nameMatch.type,
          match: nameMatch.match,
        });
        return;
      }

      const textMatch = detectModerationMatch(text);
      if (textMatch) {
        rejectComment(
          "moderation_blocked",
          "Bericht verwijderd vanwege ongewenst taalgebruik.",
          "blocked_text_word",
          textMatch.match
        );
        writeDebug("moderation_blocked", {
          clientId,
          ip,
          field: "text",
          matchType: textMatch.type,
          match: textMatch.match,
        });
        return;
      }

      if (containsLink(text)) {
        rejectComment("link_blocked", "Bericht verwijderd: links zijn niet toegestaan.", "blocked_text_link", "text link");
        writeDebug("contact_blocked", { clientId, ip, field: "text", rule: "link" });
        return;
      }

      if (containsPhoneNumber(text)) {
        rejectComment(
          "phone_blocked",
          "Bericht verwijderd: telefoonnummers zijn niet toegestaan.",
          "blocked_text_phone",
          "text phone"
        );
        writeDebug("contact_blocked", { clientId, ip, field: "text", rule: "phone" });
        return;
      }
    }

    if (!allowMessage(meta.clientKey)) {
      ws.send(safeJsonStringify({ type: "error", message: "slow down" }));
      recordChatMessage({
        clientId,
        clientKey: meta.clientKey,
        ip,
        name,
        text,
        status: "rate_limited",
        detail: "slow down",
      });
      writeDebug("comment_rate_limited", { clientId, ip });
      return;
    }

    const colorHex = getNameColorHex(name);
    const payload = { type: "comment", time: nowIso(), name, text, nameColor: colorHex };
    console.log("COMMENT:", payload);
    writeDebug("comment_received", { clientId, ip, clientKey: meta.clientKey, name, text });
    recordChatMessage({
      clientId,
      clientKey: meta.clientKey,
      ip,
      name,
      text,
      status: "accepted",
      detail: "",
    });

    broadcastToClients(payload);
    chatSimulator.observeAcceptedComment(payload);

    sendOsc("/comment/text", [{ type: "s", value: text }], { clientId, ip, channel: "comment_text" });
    sendOsc("/comment/name", [{ type: "s", value: name }], { clientId, ip, channel: "comment_name" });
    sendOsc("/comment/color", [{ type: "s", value: colorHex }], { clientId, ip, channel: "comment_color" });
  });

  ws.on("close", (code, reasonBuffer) => {
    const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString("utf8") : String(reasonBuffer || "");
    console.log("WS closed:", ip);
    connectedClients.delete(clientId);
    writeDebug("ws_closed", { clientId, ip, code: Number(code || 0), reason: reason.slice(0, 120) });
  });

  ws.on("error", (err) => {
    writeDebug("ws_error", { clientId, ip, message: err && err.message ? err.message : "unknown" });
  });
});

wss.on("error", (err) => {
  writeDebug("wss_error", { message: err && err.message ? err.message : "unknown" });
});

function startServerListening() {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    writeDebug("server_started", {
      port: PORT,
      pid: process.pid,
      restartBootDelayMs: ADMIN_RESTART_BOOT_DELAY_MS,
    });
  });
}

if (ADMIN_RESTART_BOOT_DELAY_MS > 0) {
  writeDebug("server_boot_delay", { delayMs: ADMIN_RESTART_BOOT_DELAY_MS, pid: process.pid });
  setTimeout(startServerListening, ADMIN_RESTART_BOOT_DELAY_MS);
} else {
  startServerListening();
}
