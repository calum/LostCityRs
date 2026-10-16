// Generates the "congratulating bot players" of relic mode (docs/design/relics-party-bots.md):
//   mods/relics/configs/relic_party.npc       one cosmetic npc per famous name, dressed from real obj configs (seeded, so reruns are stable)
//   mods/relics/configs/relic_party.enum      index -> npc type, index -> chat line
//   mods/relics/configs/relic_party.constant  the two counts
// Usage: node scripts/gen-relic-party.mjs   (rerun after editing NAMES or MESSAGES below; commit the output)
import fs from 'fs';
import path from 'path';

process.chdir(path.resolve(import.meta.dirname, '..'));

// REAL: well-known OSRS creators and streamers (public handles, written from memory: the wiki guide could not be fetched from the build
// sandbox, and no Twitch/Kick ranking was fetched either, so check and extend this list). JOKE: invented OSRS-flavoured names, not real people.
const REAL = ['Zezima', 'B0aty', 'Soup', 'Framed', 'Settled', 'Woox', 'Torvesta', 'Mmorpg', 'Faux', 'Sparc Mac', 'Odablock', 'Elvemage', 'Lynx Titan',
    'Skiddler', 'Swampletics', 'Mr Mammal', 'Itswinter', 'Alfie', 'Fe Santa', 'Hey Jase', 'Ayiza', 'Rendi', 'Gnome Child'];
const JOKE = ['Dry Dave', 'Ed Dawg', 'Muggy', 'Slayer Sam', 'Tob Tim', 'Cox Carl', 'Zulrah Zed', 'Boaty Mcboat', 'Fletch Fran', 'Nex Nick', 'Vorkath Vic',
    'Barrows Bo', 'Alch Andy', 'Cabbage Cal', 'Duel Dan', 'Void Val', 'Gilded Greg', 'Mith Mike', 'Rune Rob', 'Dragon Dev', 'Whip Wes', 'Anglerfish',
    'Tbow Ted', 'Scythe Sid', 'Fire Cape', 'Max Cape', 'Infernal Ian', 'Hcim Pete', 'Group Iron', 'Ironhams', 'Bored Ron', 'Lil Merc', 'Obor Boy',
    'Scorp Larry', 'Yama Yak', 'Ilovehcim', 'Zoomer Joe', 'Pk Skotizo'];
const NAMES = [...REAL, ...JOKE].map(n => n.slice(0, 12));
// Dedupe, keep order.
const UNIQ = [...new Set(NAMES)];

// Old school RuneScape chat.
const MESSAGES = [
    'gz!', 'gzzz', 'gz noob lol', 'GF!', 'gf gf', 'well played', 'ez', 'ez clap', 'nice one!', 'nicee', 'sick!', 'poggers', 'pog',
    'rip kbd', 'rip bank', 'rip my gp stake', 'ty for the kills', 'where is my cut?', 'wheres the drop?', 'drop party?', 'can i get a cape? lol',
    'any 99s here?', 'plz gz me', 'u guys r legends', 'legends', 'what a fight!', 'that was close', 'omg you did it', 'no way', 'unreal', 'insane',
    'trading 100 mith bars 200ea', 'selling rune scim 15k', 'buying gf 10k', 'lol dry', 'dry? never heard of it', 'rng carried', 'rng gods smile',
    'did u get the pet?', 'no pet lol', 'my teeth hurt', 'wc?', 'wc to my clan', 'join my cc plz', 'free gz', 'gz bro', 'gz sir', 'gz ma lord',
    'cya at ge', 'brb food', 'afk', 'anyone wanna duel?', 'want a hug?', 'o7', 'o7 o7', 'what a time to be alive', 'mom get the camera',
    'ok but can u do it with no food', 'now do it ironman', 'now do it with a bronze dagger', 'imagine dying lol', 'u dropped ur cape', 'F2P btw',
    'ur so good', 'lol i was here', 'hi mom', 'noob', 'boaty approved', 'woox would be proud', 'this is my favourite part', 'gnome child did it better',
    'ez 99', 'can i have ur gp when u die', 'plz drop ur fire cape', 'uwu gz', 'much wow', 'kk cya', 'ggs'
];

// Mulberry32, seeded: the same output every run.
let s = 0x1d2b3c4d;
const rnd = () => ((s = (s + 0x6d2b79f5) | 0), (t => ((t ^ (t >>> 14)) >>> 0) / 4294967296)(Math.imul(s ^ (s >>> 15), 1 | s)));
const pick = a => a[Math.floor(rnd() * a.length)];

const modelNames = new Set(fs.readFileSync('Content/pack/model.pack', 'utf8').split(/\r?\n/).map(l => l.split('=')[1]).filter(Boolean));

function walk(d) {
    return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? (e.name === '_mods' || e.name === '_unpack' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.obj') ? [path.join(d, e.name)] : []));
}

// Parse objs that are worn: slot -> [{ models: [name...], recol: [[s,d]...] }]
const gear = { hat: [], torso: [], legs: [], feet: [], hands: [], righthand: [], lefthand: [], back: [] };
for (const f of walk('Content/scripts')) {
    for (const block of fs.readFileSync(f, 'utf8').split(/^\[/m).slice(1)) {
        const lines = block.split(/\r?\n/);
        const kv = {};
        const recol = {};
        for (const l of lines.slice(1)) {
            const m = /^(\w+)=(.*)$/.exec(l);
            if (!m) continue;
            if (/^recol\d[sd]$/.test(m[1])) recol[m[1]] = Number(m[2]);
            else if (!(m[1] in kv)) kv[m[1]] = m[2];
        }
        const slot = kv.wearpos;
        if (!(slot in gear) || !kv.manwear) continue;
        const models = [kv.manwear, kv.manwear2, kv.manwear3].filter(Boolean).map(v => v.split(',')[0]);
        if (!models.every(m => modelNames.has(m))) continue;
        const pairs = [];
        for (let i = 1; i <= 6; i++) if (recol[`recol${i}s`] !== undefined && recol[`recol${i}d`] !== undefined) pairs.push([recol[`recol${i}s`], recol[`recol${i}d`]]);
        gear[slot].push({ models, pairs });
    }
}
for (const [k, v] of Object.entries(gear)) if (!v.length) throw new Error(`no gear for ${k}`);

const HAIR = ['man_head_longhair', 'man_head_shorthair', 'man_head_mediumhair', 'man_head_shorthair2', 'man_head_spikeyhair', 'man_head_spikeyhair2', 'man_head_dredlocks', 'man_head_bald', 'man_head_tribal', 'man_head_pirate'].filter(m => modelNames.has(m));
const JAWS = ['man_jaw_none', 'man_jaw_goaty', 'man_jaw_long', 'man_jaw_medium', 'man_jaw_moustache', 'man_jaw_short', 'man_jaw_short2', 'man_jaw_split'].filter(m => modelNames.has(m));
const HAIRCOL = [2340, 6273, 24075, 7330, 10570, 3272, 15855, 41, 5409];

const out = [];
const enumNames = ['[relic_party_names]', 'inputtype=int', 'outputtype=npc', 'default=null'];
UNIQ.forEach((name, i) => {
    const id = `relic_party_${i + 1}`;
    const wear = [];
    const models = [];
    const pairs = [];
    const add = g => {
        for (const m of g.models) if (!models.includes(m)) models.push(m);
        for (const p of g.pairs) if (pairs.length < 6 && !pairs.some(q => q[0] === p[0])) pairs.push(p);
    };
    // 70% a hat-less head with hair and beard, 30% a hat on top (the head model stays under it).
    models.push(pick(HAIR), pick(JAWS));
    const body = rnd() < 0.85 ? pick(gear.torso) : null;
    if (body) add(body);
    else models.push('man_torso_basic', 'man_arms_basic');
    if (rnd() < 0.3) add(pick(gear.hat));
    if (rnd() < 0.85) add(pick(gear.legs));
    else models.push('man_legs_basic');
    if (rnd() < 0.8) add(pick(gear.feet));
    else models.push('man_feet_basic');
    if (rnd() < 0.5) add(pick(gear.hands));
    else models.push('man_hands_basic');
    add(pick(gear.righthand));
    if (rnd() < 0.4) add(pick(gear.lefthand));
    if (rnd() < 0.4) add(pick(gear.back));
    if (pairs.length < 6) pairs.push([2340, pick(HAIRCOL)]);
    out.push(`[${id}]`, 'vislevel=hide', `name=${name}`, 'desc=Here to say congratulations.', 'walkanim=human_walk_f,human_walk_b,human_walk_l,human_walk_r', 'readyanim=human_ready',
        'category=relic_party', 'timer=6', 'blockwalk=none');
    pairs.forEach(([a, b], k) => out.push(`recol${k + 1}s=${a}`, `recol${k + 1}d=${b}`));
    models.forEach((m, k) => out.push(`model${k + 1}=${m}`));
    out.push('');
    enumNames.push(`val=${i + 1},${id}`);
    void wear;
});

fs.writeFileSync('mods/relics/configs/relic_party.npc', '// GENERATED by scripts/gen-relic-party.mjs: do not edit by hand.\n' + out.join('\n'));
const enumMsgs = ['[relic_party_msgs]', 'inputtype=int', 'outputtype=string', 'default=gz', ...MESSAGES.map((m, i) => `val=${i + 1},${m}`)];
fs.writeFileSync('mods/relics/configs/relic_party.enum', '// GENERATED by scripts/gen-relic-party.mjs: do not edit by hand.\n' + enumNames.join('\n') + '\n\n' + enumMsgs.join('\n') + '\n');
fs.writeFileSync('mods/relics/configs/relic_party.constant', `// GENERATED by scripts/gen-relic-party.mjs\n^relic_party_names = ${UNIQ.length}\n^relic_party_msgs = ${MESSAGES.length}\n`);
console.log(`${UNIQ.length} names, ${MESSAGES.length} messages, gear pools:`, Object.fromEntries(Object.entries(gear).map(([k, v]) => [k, v.length])));
