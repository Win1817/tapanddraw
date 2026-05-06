import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════
const SCRYFALL_SEARCH = "https://api.scryfall.com/cards/search";
const PHASES = ["Untap","Upkeep","Draw","Main 1","Combat","Main 2","End"];
const COLORS = { W:"#d4c87a", U:"#3a8fd8", B:"#8a5aaa", R:"#e05520", G:"#3a8a3a" };
const MANA_BG = { W:"#f5f0dc", U:"#1e69b0", B:"#2d2d2d", R:"#cc3300", G:"#1a6b1a", C:"#777" };
const MANA_FG = { W:"#b8a000", U:"#aed4f5", B:"#aaaaaa", R:"#f5a080", G:"#80c880", C:"#ddd" };

const STARTER_DECKS = [
  { name:"Red Aggro",   query:"(t:creature+OR+name:Lightning+Bolt+OR+name:Shock+OR+name:Mountain+OR+name:Goblin+Guide) c:r is:reprint", color:"#e05520", icon:"🔥" },
  { name:"Blue Control",query:"(name:Counterspell+OR+name:Brainstorm+OR+name:Island+OR+name:Opt+OR+name:Divination) c:u is:reprint", color:"#3a8fd8", icon:"💧" },
  { name:"Green Stompy",query:"(name:Llanowar+Elves+OR+name:Forest+OR+t:elf+OR+name:Giant+Growth+OR+name:Rancor) c:g is:reprint", color:"#3a8a3a", icon:"🌿" },
];

// ═══════════════════════════════════════════════════════════════════════
// HEROES
// ═══════════════════════════════════════════════════════════════════════
const HEROES = [
  {
    id:"pyromancer", name:"Pyromancer", title:"The Flame Warden",
    color:"#e05520", icon:"🔥", manaColor:"R",
    passive:"Whenever you play an Instant or Sorcery, deal 1 damage to opponent.",
    active:"Burn: Deal 3 damage to opponent. (Once per turn)",
    activeCost:"Tap 1 mana",
    applyPassive:(gs,card)=>{
      if(isInstant(card)||isSorcery(card)){
        return {...gs, oppLife: gs.oppLife - 1, heroLog:`🔥 Pyromancer passive: 1 damage!`};
      }
      return gs;
    },
    applyActive:(gs)=>({...gs, oppLife: gs.oppLife - 3, heroLog:`🔥 Pyromancer BURN: 3 damage!`}),
  },
  {
    id:"warden", name:"Warden", title:"The Life Warden",
    color:"#3a8a3a", icon:"🌿", manaColor:"G",
    passive:"Whenever you play a creature, gain 1 life.",
    active:"Regrowth: Gain 5 life. (Once per turn)",
    activeCost:"Tap 2 mana",
    applyPassive:(gs,card)=>{
      if(isCreature(card)){
        return {...gs, life: gs.life + 1, heroLog:`🌿 Warden passive: +1 life!`};
      }
      return gs;
    },
    applyActive:(gs)=>({...gs, life: gs.life + 5, heroLog:`🌿 Warden REGROWTH: +5 life!`}),
  },
  {
    id:"arcanist", name:"Arcanist", title:"The Mind Sculptor",
    color:"#3a8fd8", icon:"💧", manaColor:"U",
    passive:"Whenever you draw a card, Scry 1 (top of library stays or goes to bottom).",
    active:"Insight: Draw 2 cards. (Once per turn)",
    activeCost:"Tap 2 mana",
    applyPassive:(gs)=>({...gs, heroLog:`💧 Arcanist passive: Scry 1.`}),
    applyActive:(gs)=>{
      if(gs.library.length < 2) return {...gs, heroLog:`💧 Arcanist INSIGHT: Library too small!`};
      const [a,b,...rest]=gs.library;
      return {...gs, library:rest, hand:[...gs.hand,a,b], heroLog:`💧 Arcanist INSIGHT: Drew 2 cards!`};
    },
  },
  {
    id:"necromancer", name:"Necromancer", title:"The Grave Caller",
    color:"#8a5aaa", icon:"💀", manaColor:"B",
    passive:"Whenever a creature dies, put a +1/+1 counter on one of your creatures.",
    active:"Reanimate: Return top creature from graveyard to battlefield. (Once per turn)",
    activeCost:"Tap 2 mana",
    applyPassive:(gs)=>{
      const creatures=gs.battlefield.filter(i=>isCreature(i.card));
      if(!creatures.length) return {...gs, heroLog:`💀 Necromancer passive: No creature to buff.`};
      const target=creatures[creatures.length-1];
      return {...gs, battlefield:gs.battlefield.map(i=>i.uid===target.uid?{...i,counters:{...i.counters,"+1/+1":(i.counters["+1/+1"]||0)+1}}:i), heroLog:`💀 Necromancer passive: +1/+1 on ${target.card.name}!`};
    },
    applyActive:(gs)=>{
      const deadCreatures=gs.graveyard.filter(i=>isCreature(i.card));
      if(!deadCreatures.length) return {...gs, heroLog:`💀 Necromancer: No creatures in graveyard!`};
      const top=deadCreatures[deadCreatures.length-1];
      return {...gs, graveyard:gs.graveyard.filter(i=>i.uid!==top.uid), battlefield:[...gs.battlefield,{...top,tapped:false,summoningSick:false}], heroLog:`💀 Necromancer REANIMATE: ${top.card.name} rises!`};
    },
  },
  {
    id:"champion", name:"Champion", title:"The Battlefield Legend",
    color:"#c8a800", icon:"⚔️", manaColor:"W",
    passive:"Your attacking creatures get +1/+0 this turn.",
    active:"Rally: Untap all your creatures. (Once per turn)",
    activeCost:"Tap 1 mana",
    applyPassive:(gs)=>({...gs, heroLog:`⚔️ Champion passive: Attackers +1/+0.`}),
    applyActive:(gs)=>({...gs, battlefield:gs.battlefield.map(i=>({...i,tapped:false,summoningSick:false})), heroLog:`⚔️ Champion RALLY: All creatures untapped!`}),
  },
];

// ═══════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════
const uid       = () => Math.random().toString(36).slice(2,10);
const parseMana = (c="") => [...(c||"").matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);
const cmc       = (c="") => parseMana(c).reduce((s,sym)=>{ const n=parseInt(sym); return s+(isNaN(n)?("WUBRG".includes(sym)||sym==="C"?1:0):n); },0);
const isCreature= c => !!c?.type_line?.includes("Creature");
const isLand    = c => !!c?.type_line?.includes("Land");
const isInstant = c => !!c?.type_line?.includes("Instant");
const isSorcery = c => !!c?.type_line?.includes("Sorcery");
const isEnchant = c => !!c?.type_line?.includes("Enchantment");
const isArtifact= c => !!c?.type_line?.includes("Artifact");
const shuffle   = arr => [...arr].sort(()=>Math.random()-.5);
const nowStr    = () => { const d=new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const mkInst    = card => ({ uid:uid(), card, tapped:false, counters:{"+1/+1":0,"-1/-1":0}, attacking:false, blocking:null, summoningSick:true, enchantments:[] });
const borderColor = card => {
  const s=parseMana(card?.mana_cost||"").filter(x=>"WUBRG".includes(x));
  return s.length===0?"#666":s.length>1?"#c8a800":COLORS[s[0]]||"#666";
};

// ═══════════════════════════════════════════════════════════════════════
// ══  CARD EFFECT ENGINE  ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// Returns { gs, messages[] } — pure function on game state
function applyCardEffect(card, gs, source="player") {
  const txt = (card.oracle_text||"").toLowerCase();
  const msgs = [];
  let g = { ...gs,
    library:[...gs.library], hand:[...gs.hand], battlefield:[...gs.battlefield],
    graveyard:[...gs.graveyard], exile:[...gs.exile],
    opp:{ ...gs.opp, battlefield:[...gs.opp.battlefield], hand:[...gs.opp.hand], library:[...gs.opp.library], graveyard:[...gs.opp.graveyard||[]] }
  };

  // ── Helpers ──────────────────────────────────────────────
  const dmgOpponent = (n) => {
    if(source==="player"){ g.oppLife=(g.oppLife||20)-n; msgs.push({text:`${card.name} deals ${n} damage to opponent! (${g.oppLife} life)`,type:"damage"}); }
    else { g.life=(g.life||20)-n; msgs.push({text:`Opponent's ${card.name} deals ${n} damage to you! (${g.life} life)`,type:"damage"}); }
  };
  const gainLife = (n) => {
    if(source==="player"){ g.life=(g.life||20)+n; msgs.push({text:`${card.name}: You gain ${n} life. (${g.life} total)`,type:"heal"}); }
    else { g.opp={...g.opp,life:(g.opp.life||20)+n}; msgs.push({text:`Opponent gains ${n} life.`,type:"opp"}); }
  };
  const drawCards = (n) => {
    if(source==="player"){
      for(let i=0;i<n;i++){
        if(!g.library.length) break;
        const[d,...rest]=g.library; g.library=rest; g.hand=[...g.hand,d];
      }
      msgs.push({text:`${card.name}: Drew ${n} card(s).`,type:"action"});
    } else {
      for(let i=0;i<n;i++){
        if(!g.opp.library.length) break;
        const[d,...rest]=g.opp.library; g.opp={...g.opp,library:rest,hand:[...g.opp.hand,d]};
      }
    }
  };
  const discardRandom = (n) => {
    if(source==="player"){
      for(let i=0;i<n&&g.hand.length;i++){
        const idx=Math.floor(Math.random()*g.hand.length);
        g.graveyard=[...g.graveyard,g.hand[idx]]; g.hand=g.hand.filter((_,j)=>j!==idx);
      }
      if(n>0) msgs.push({text:`${card.name}: You discarded ${n} card(s).`,type:"action"});
    }
  };
  const destroyCreature=(targetSelf=false)=>{
    const pool=targetSelf
      ? g.battlefield.filter(i=>isCreature(i.card))
      : (source==="player"?g.opp.battlefield:g.battlefield).filter(i=>isCreature(i.card));
    if(!pool.length){ msgs.push({text:`${card.name}: No valid target.`,type:"action"}); return; }
    const target=pool[Math.floor(Math.random()*pool.length)];
    if(targetSelf||source!=="player"){
      g.battlefield=g.battlefield.filter(i=>i.uid!==target.uid);
      g.graveyard=[...g.graveyard,target];
    } else {
      g.opp.battlefield=g.opp.battlefield.filter(i=>i.uid!==target.uid);
      g.opp.graveyard=[...g.opp.graveyard,target];
    }
    msgs.push({text:`${card.name}: Destroyed ${target.card.name}!`,type:"combat"});
  };
  const exileCreature=()=>{
    const pool=(source==="player"?g.opp.battlefield:g.battlefield).filter(i=>isCreature(i.card));
    if(!pool.length){ msgs.push({text:`${card.name}: No creature to exile.`,type:"action"}); return; }
    const target=pool[Math.floor(Math.random()*pool.length)];
    if(source==="player"){
      g.opp.battlefield=g.opp.battlefield.filter(i=>i.uid!==target.uid);
    } else {
      g.battlefield=g.battlefield.filter(i=>i.uid!==target.uid);
    }
    g.exile=[...g.exile,target];
    msgs.push({text:`${card.name}: Exiled ${target.card.name}!`,type:"combat"});
  };
  const bounceCreature=()=>{
    const pool=(source==="player"?g.opp.battlefield:g.battlefield).filter(i=>isCreature(i.card));
    if(!pool.length){ msgs.push({text:`${card.name}: No creature to bounce.`,type:"action"}); return; }
    const target=pool[Math.floor(Math.random()*pool.length)];
    if(source==="player"){
      g.opp.battlefield=g.opp.battlefield.filter(i=>i.uid!==target.uid);
      g.opp.hand=[...g.opp.hand,target];
    } else {
      g.hand=[...g.hand,target];
      g.battlefield=g.battlefield.filter(i=>i.uid!==target.uid);
    }
    msgs.push({text:`${card.name}: Returned ${target.card.name} to hand.`,type:"action"});
  };
  const counterSpell=()=>{
    msgs.push({text:`${card.name}: Countered the last spell (flavour).`,type:"action"});
  };
  const addCounters=(type,n)=>{
    const pool=(source==="player"?g.battlefield:g.battlefield).filter(i=>isCreature(i.card));
    if(!pool.length) return;
    const target=pool[pool.length-1];
    g.battlefield=g.battlefield.map(i=>i.uid===target.uid?{...i,counters:{...i.counters,[type]:(i.counters[type]||0)+n}}:i);
    msgs.push({text:`${card.name}: Put ${n} ${type} counter(s) on ${target.card.name}.`,type:"action"});
  };
  const tapAllOpponent=()=>{
    g.opp.battlefield=g.opp.battlefield.map(i=>({...i,tapped:true}));
    msgs.push({text:`${card.name}: Tapped all opponent's creatures.`,type:"action"});
  };
  const millCards=(n)=>{
    const milled=[];
    for(let i=0;i<n;i++){
      if(!g.opp.library.length) break;
      const[top,...rest]=g.opp.library; g.opp.library=rest; milled.push(top);
    }
    g.opp.graveyard=[...g.opp.graveyard,...milled];
    if(milled.length) msgs.push({text:`${card.name}: Milled ${milled.length} card(s) from opponent's library.`,type:"action"});
  };
  const scryTop=(n)=>{
    msgs.push({text:`${card.name}: Scry ${n} — top of library arranged.`,type:"action"});
  };
  const searchBasicLand=()=>{
    const basic=g.library.find(i=>i.card.type_line?.includes("Basic Land"));
    if(basic){
      g.library=g.library.filter(i=>i.uid!==basic.uid);
      g.hand=[...g.hand,basic];
      msgs.push({text:`${card.name}: Found ${basic.card.name} and put it in hand.`,type:"action"});
    } else {
      msgs.push({text:`${card.name}: No basic land found in library.`,type:"action"});
    }
  };
  const dmgToAll=(n)=>{
    g.oppLife=(g.oppLife||20)-n; g.life=(g.life||20)-n;
    g.battlefield=g.battlefield.filter(i=>!isCreature(i.card)||(parseInt(i.card.toughness)||0)>n);
    g.opp.battlefield=g.opp.battlefield.filter(i=>!isCreature(i.card)||(parseInt(i.card.toughness)||0)>n);
    msgs.push({text:`${card.name}: Deals ${n} damage to everything!`,type:"damage"});
  };
  const createToken=(name,pw,tg,colSym)=>{
    const tokenCard={id:`tok-${uid()}`,name,type_line:"Token Creature",mana_cost:`{${colSym}}`,oracle_text:"",power:String(pw),toughness:String(tg),image_uris:null};
    const inst={...mkInst(tokenCard),summoningSick:false};
    g.battlefield=[...g.battlefield,inst];
    msgs.push({text:`${card.name}: Created a ${pw}/${tg} ${name} token.`,type:"action"});
  };
  const haste=(inst)=>{
    g.battlefield=g.battlefield.map(i=>i.uid===inst.uid?{...i,summoningSick:false}:i);
  };

  // ── Effect Dispatch by oracle text patterns ───────────────
  let handled=false;

  // === DAMAGE TO OPPONENT / TARGET PLAYER ===
  const dmgMatch=txt.match(/deals? (\d+) damage to (any target|target player|target opponent|each opponent|each player|opponent)/);
  const dmgMatchAny=txt.match(/deals? x damage/) || txt.match(/deals? (\d+) damage to each creature/);
  if(dmgMatch){
    const n=parseInt(dmgMatch[1]);
    if(dmgMatch[2].includes("each player")||dmgMatch[2].includes("each opponent")){ dmgToAll(n); }
    else dmgOpponent(n);
    handled=true;
  }
  if(dmgMatchAny && !handled){ dmgToAll(2); handled=true; }

  // Lightning Bolt style: 3 damage
  if(!handled && (txt.includes("lightning bolt")||txt.includes("deals 3 damage"))){ dmgOpponent(3); handled=true; }
  // Shock: 2 damage
  if(!handled && txt.includes("deals 2 damage")){ dmgOpponent(2); handled=true; }
  // Fireball / X spells
  if(!handled && txt.includes("deals x damage")){ dmgOpponent(4); handled=true; }
  // Lava Spike etc
  if(!handled && txt.includes("deals 3 damage to target player")){ dmgOpponent(3); handled=true; }

  // === DRAW ===
  const drawMatch=txt.match(/draw (\w+) card/);
  if(drawMatch){
    const word=drawMatch[1]; const n={"a":1,"one":1,"two":2,"three":3,"four":4,"five":5,"x":3}[word]||parseInt(word)||1;
    drawCards(n); handled=true;
  }
  if(!handled && txt.includes("draw a card")){ drawCards(1); handled=true; }
  if(!handled && txt.includes("draw two cards")){ drawCards(2); handled=true; }
  if(!handled && txt.includes("draw three cards")){ drawCards(3); handled=true; }
  if(!handled && txt.includes("cantrip")){ drawCards(1); handled=true; }

  // Brainstorm: draw 3, put 2 back
  if(txt.includes("draw three cards, then put two cards from your hand on top")){
    drawCards(3); discardRandom(2); msgs.push({text:`${card.name}: Put 2 cards back on top.`,type:"action"}); handled=true;
  }
  // Opt / Portent: scry then draw
  if(txt.includes("scry")&&txt.includes("draw a card")){
    const scryMatch=txt.match(/scry (\d+)/); scryTop(scryMatch?parseInt(scryMatch[1]):1); drawCards(1); handled=true;
  }

  // === LIFE GAIN ===
  const gainMatch=txt.match(/you gain (\d+) life/);
  if(gainMatch){ gainLife(parseInt(gainMatch[1])); handled=true; }
  const gainMatch2=txt.match(/gain (\d+) life/);
  if(!handled&&gainMatch2){ gainLife(parseInt(gainMatch2[1])); handled=true; }
  // Drain (damage+gain)
  if(txt.includes("loses") && txt.includes("you gain")){
    const loseM=txt.match(/loses (\d+) life/); const gainM=txt.match(/you gain (\d+) life/);
    if(loseM){ dmgOpponent(parseInt(loseM[1])); }
    if(gainM){ gainLife(parseInt(gainM[1])); }
    handled=true;
  }

  // === DESTROY ===
  if(txt.includes("destroy target creature")){ destroyCreature(); handled=true; }
  if(txt.includes("destroy all creatures")){ dmgToAll(99); handled=true; }
  if(txt.includes("destroy target nonland permanent")||txt.includes("destroy target artifact or enchantment")){ destroyCreature(); handled=true; }
  if(txt.includes("destroy target land")||txt.includes("destroy target artifact")||txt.includes("destroy target enchantment")){
    msgs.push({text:`${card.name}: Target permanent destroyed.`,type:"action"}); handled=true;
  }

  // === EXILE ===
  if(txt.includes("exile target creature")||txt.includes("exile target nonland")){ exileCreature(); handled=true; }

  // === BOUNCE (return to hand) ===
  if(txt.includes("return target creature")&&txt.includes("to its owner's hand")){ bounceCreature(); handled=true; }
  if(txt.includes("return target nonland permanent")&&txt.includes("to its owner's hand")){ bounceCreature(); handled=true; }

  // === COUNTER SPELL ===
  if(txt.includes("counter target spell")||txt.includes("counter target noncreature")){ counterSpell(); handled=true; }

  // === MILL ===
  const millMatch=txt.match(/mill (\d+)/)||txt.match(/put the top (\d+) cards? of target (player|opponent)'s library into their graveyard/);
  if(millMatch){ millCards(parseInt(millMatch[1])); handled=true; }

  // === SCRY (alone) ===
  if(!handled && txt.includes("scry")){
    const sm=txt.match(/scry (\d+)/); scryTop(sm?parseInt(sm[1]):1); handled=true;
  }

  // === SEARCH / TUTOR ===
  if(txt.includes("search your library for a basic land")){ searchBasicLand(); handled=true; }
  if(txt.includes("search your library for a land card")){ searchBasicLand(); handled=true; }

  // === DISCARD ===
  const discardMatch=txt.match(/discard (\w+) card/);
  if(!handled&&discardMatch){
    const n={"a":1,"one":1,"two":2}[discardMatch[1]]||1; discardRandom(n); handled=true;
  }

  // === TAP ALL OPPONENTS ===
  if(txt.includes("tap all creatures your opponents control")||txt.includes("tap all creatures target player controls")){
    tapAllOpponent(); handled=true;
  }

  // === COUNTER GRANTS (pumps, auras) ===
  if(txt.includes("+1/+1 counter")&&(txt.includes("put a +1/+1")||txt.includes("put two +1/+1"))){
    const n=txt.includes("two")?2:1; addCounters("+1/+1",n); handled=true;
  }
  if(txt.includes("proliferate")){
    // Add a +1/+1 counter to each creature with a counter
    g.battlefield=g.battlefield.map(i=>i.counters["+1/+1"]>0?{...i,counters:{...i.counters,"+1/+1":i.counters["+1/+1"]+1}}:i);
    msgs.push({text:`${card.name}: Proliferate — added counters.`,type:"action"}); handled=true;
  }

  // === TOKEN CREATION ===
  const tokenMatch=txt.match(/create (?:a|an|two|three|(\d+)) (\d+)\/(\d+) (.+?) creature token/);
  if(tokenMatch){
    const n=parseInt(tokenMatch[1])||1; const pw=tokenMatch[2]; const tg=tokenMatch[3]; const name=tokenMatch[4];
    for(let i=0;i<n;i++) createToken(name,pw,tg,"C");
    handled=true;
  }
  // Saprolings, Soldiers, Zombies etc
  if(!handled&&txt.includes("create")&&txt.includes("token")){
    const m=txt.match(/create (?:a |an |two |three )?(\d+)\/(\d+)/);
    if(m){ createToken("Creature",m[1],m[2],"C"); handled=true; }
  }

  // === LAND — PRODUCES MANA (tap for mana) ===
  if(isLand(card)){
    const manaMap={plains:"W",island:"U",swamp:"B",mountain:"R",forest:"G"};
    const name=card.name.toLowerCase();
    const basic=manaMap[name];
    if(basic){
      g.mana={...g.mana,[basic]:(g.mana[basic]||0)+1};
      msgs.push({text:`${card.name} enters the battlefield. Tap for {${basic}}.`,type:"action"});
    } else {
      // Dual lands / fetch lands
      const addM=txt.match(/add \{([wubrg])\}/gi)||[];
      if(addM.length){
        addM.forEach(m=>{ const c=m.match(/\{([wubrg])\}/i)?.[1]?.toUpperCase(); if(c) g.mana={...g.mana,[c]:(g.mana[c]||0)+1}; });
        msgs.push({text:`${card.name} enters the battlefield.`,type:"action"});
      } else {
        msgs.push({text:`${card.name} enters the battlefield.`,type:"action"});
      }
    }
    handled=true;
  }

  // === CREATURES — ENTER-THE-BATTLEFIELD (ETB) ===
  if(isCreature(card)){
    // ETB draw
    if(txt.includes("when")||(txt.includes("enters")&&txt.includes("draw a card"))){ drawCards(1); }
    // ETB damage
    const etbDmg=txt.match(/when.{0,40}enters.{0,40}deals? (\d+) damage/);
    if(etbDmg){ dmgOpponent(parseInt(etbDmg[1])); }
    // ETB life
    const etbLife=txt.match(/when.{0,40}enters.{0,40}you gain (\d+) life/);
    if(etbLife){ gainLife(parseInt(etbLife[1])); }
    // ETB draw 2
    if(txt.includes("when")&&txt.includes("draw two cards")){ drawCards(2); }
    // ETB destroy
    if(txt.includes("when")&&txt.includes("enters")&&txt.includes("destroy target")){ destroyCreature(); }
    // ETB exile
    if(txt.includes("when")&&txt.includes("enters")&&txt.includes("exile target")){ exileCreature(); }
    // ETB bounce
    if(txt.includes("when")&&txt.includes("enters")&&txt.includes("return target")){ bounceCreature(); }
    // Haste
    if(txt.includes("haste")){
      const lastInst=g.battlefield[g.battlefield.length-1];
      if(lastInst) haste(lastInst);
      msgs.push({text:`${card.name} has haste!`,type:"action"});
    }
    // Lifelink
    if(txt.includes("lifelink")){ msgs.push({text:`${card.name}: Lifelink — will gain life when it deals damage.`,type:"action"}); }
    // Deathtouch
    if(txt.includes("deathtouch")){ msgs.push({text:`${card.name}: Deathtouch — destroys creatures it damages.`,type:"action"}); }
    // Flying
    if(txt.includes("flying")&&txt.includes("can't be blocked")){ msgs.push({text:`${card.name}: Evasion — can't be blocked.`,type:"action"}); }
    // Trample
    if(txt.includes("trample")){ msgs.push({text:`${card.name}: Trample — excess damage hits opponent.`,type:"action"}); }
    // Vigilance
    if(txt.includes("vigilance")){ msgs.push({text:`${card.name}: Vigilance — doesn't tap to attack.`,type:"action"}); }
    // First strike
    if(txt.includes("first strike")||txt.includes("double strike")){ msgs.push({text:`${card.name}: ${txt.includes("double strike")?"Double strike":"First strike"} — strikes first in combat.`,type:"action"}); }
    // Menace
    if(txt.includes("menace")){ msgs.push({text:`${card.name}: Menace — must be blocked by two or more creatures.`,type:"action"}); }
    if(!msgs.length) msgs.push({text:`${card.name} enters the battlefield.`,type:"action"});
    handled=true;
  }

  // === ENCHANTMENTS ===
  if(isEnchant(card)){
    // Aura-style: boost a creature
    const auraBoost=txt.match(/enchanted creature gets \+(\d+)\/\+(\d+)/);
    if(auraBoost){
      const pw=parseInt(auraBoost[1]), tg=parseInt(auraBoost[2]);
      const creatures=g.battlefield.filter(i=>isCreature(i.card));
      if(creatures.length){
        const last=creatures[creatures.length-1];
        g.battlefield=g.battlefield.map(i=>i.uid===last.uid?{...i,counters:{...i.counters,"+1/+1":Math.max(i.counters["+1/+1"]||0,pw)}}:i);
        msgs.push({text:`${card.name}: Enchanted ${last.card.name} +${pw}/+${tg}.`,type:"action"});
      }
    }
    // Shroud / hexproof
    if(txt.includes("hexproof")||txt.includes("shroud")){ msgs.push({text:`${card.name}: Target creature gains hexproof.`,type:"action"}); }
    // Global enchantment effects
    if(txt.includes("whenever a creature attacks")&&txt.includes("draw a card")){ msgs.push({text:`${card.name}: Draw a card whenever a creature attacks.`,type:"action"}); }
    if(!msgs.length) msgs.push({text:`${card.name}: Enchantment enters the battlefield.`,type:"action"});
    handled=true;
  }

  // === ARTIFACTS ===
  if(isArtifact(card)){
    if(txt.includes("add {c}")){ g.mana={...g.mana,C:(g.mana.C||0)+1}; msgs.push({text:`${card.name}: Mox/rock adds {C} to mana pool.`,type:"action"}); handled=true; }
    if(txt.includes("draw a card")){ drawCards(1); handled=true; }
    if(!msgs.length){ msgs.push({text:`${card.name}: Artifact enters the battlefield.`,type:"action"}); handled=true; }
  }

  // === FALLBACK ===
  if(!handled||!msgs.length){
    msgs.push({text:`${card.name} resolves.`,type:"action"});
  }

  return { gs: g, messages: msgs };
}

// ═══════════════════════════════════════════════════════════════════════
// GLOBAL CSS
// ═══════════════════════════════════════════════════════════════════════
const GCSS=`
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#04040c;color:#ddd;font-family:'Crimson Pro',serif;}
  ::-webkit-scrollbar{width:4px;height:4px;}
  ::-webkit-scrollbar-track{background:#0d0d1a;}
  ::-webkit-scrollbar-thumb{background:#2a2a4a;border-radius:2px;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
  @keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}
  @keyframes slideUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
  @keyframes dmgFloat{0%{opacity:1;transform:translateY(0) scale(1)}50%{opacity:1;transform:translateY(-22px) scale(1.2)}100%{opacity:0;transform:translateY(-48px) scale(.8)}}
  @keyframes cardPlay{0%{opacity:0;transform:scale(.7) translateY(20px)}100%{opacity:1;transform:scale(1) translateY(0)}}
  .chov:hover{transform:translateY(-10px) scale(1.05)!important;z-index:20!important;}
  .btn:hover{filter:brightness(1.2);}
  .btn:active{transform:scale(.96);}
`;

// ═══════════════════════════════════════════════════════════════════════
// MANA SYMBOL
// ═══════════════════════════════════════════════════════════════════════
function ManaSymbol({sym,size=16}){
  const bg=MANA_BG[sym]||"#555",fg=MANA_FG[sym]||"#eee",isCol="WUBRG".includes(sym);
  return <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:size,height:size,borderRadius:"50%",flexShrink:0,background:isCol?bg:"#555",color:isCol?fg:"#ddd",fontSize:size*.56,fontWeight:800,fontFamily:"serif",lineHeight:1,border:`1.5px solid ${isCol?fg:"#888"}`,boxShadow:"inset 0 1px 2px rgba(255,255,255,.15),0 1px 3px rgba(0,0,0,.5)"}}>{sym}</span>;
}

// ═══════════════════════════════════════════════════════════════════════
// SPELL EFFECT TOAST
// ═══════════════════════════════════════════════════════════════════════
function EffectToast({toasts}){
  return(
    <div style={{position:"fixed",top:70,right:14,zIndex:8900,display:"flex",flexDirection:"column",gap:6,pointerEvents:"none"}}>
      {toasts.map(t=>(
        <div key={t.id} style={{
          background:t.type==="damage"?"#3a0808":t.type==="heal"?"#083a08":t.type==="combat"?"#3a2800":"#0a0a1a",
          border:`1px solid ${t.type==="damage"?"#cc3311":t.type==="heal"?"#33cc55":t.type==="combat"?"#cc8800":"#2a2a4a"}`,
          borderRadius:7,padding:"7px 12px",maxWidth:280,animation:"slideUp .25s ease",
          color:t.type==="damage"?"#ff8866":t.type==="heal"?"#66ff88":t.type==="combat"?"#ffcc44":"#aabbcc",
          fontSize:11,fontFamily:"'Crimson Pro',serif",lineHeight:1.4,
          boxShadow:`0 4px 20px ${t.type==="damage"?"rgba(200,50,0,.3)":t.type==="heal"?"rgba(0,200,80,.2)":"rgba(0,0,0,.5)"}`,
        }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MTG CARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════
function MTGCard({card,size="normal",onClick,onContextMenu,tapped,selected,attacking,summoningSick,counters={},draggable,onDragStart,fresh}){
  const border=borderColor(card);
  const manaSyms=parseMana(card.mana_cost||"");
  const img=card.image_uris?.normal||card.image_uris?.small||card.card_faces?.[0]?.image_uris?.normal;
  const dims={tiny:{w:54,h:76,fs:7},small:{w:86,h:120,fs:8},normal:{w:136,h:190,fs:10},large:{w:200,h:280,fs:12}};
  const d=dims[size]||dims.normal;
  const p1=counters["+1/+1"]||0,m1=counters["-1/-1"]||0;
  const type=isCreature(card)?"⚔️":isLand(card)?"🏔️":isInstant(card)?"⚡":isSorcery(card)?"✨":isEnchant(card)?"🌀":isArtifact(card)?"⚙️":"✦";

  return(
    <div draggable={draggable} onDragStart={onDragStart} onClick={onClick} onContextMenu={onContextMenu}
      className={!tapped?"chov":""} title={card.name}
      style={{width:d.w,height:d.h,borderRadius:7,flexShrink:0,cursor:"pointer",
        border:`2.5px solid ${selected?"#f5c842":attacking?"#ff6622":border}`,
        transform:tapped?"rotate(90deg)":"none",
        transition:"transform .2s,box-shadow .15s",
        boxShadow:selected?`0 0 0 3px #f5c84255,0 0 20px #f5c84233`:attacking?`0 0 14px #ff662266`:`0 4px 14px rgba(0,0,0,.7)`,
        position:"relative",background:"#0d0d1a",overflow:"hidden",
        opacity:summoningSick&&isCreature(card)?.4:1,
        animation:fresh?"cardPlay .3s ease":"none"}}>
      {img
        ?<img src={img} alt={card.name} loading="lazy" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
        :<div style={{width:"100%",height:"100%",padding:5,display:"flex",flexDirection:"column",gap:2,background:`linear-gradient(160deg,#1e1e3a,#0d0d1a)`,color:"#ddd",fontFamily:"'Cinzel',serif"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:2}}>
            <span style={{fontSize:d.fs+1,fontWeight:700,lineHeight:1.2,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.name}</span>
            <div style={{display:"flex",gap:1,flexShrink:0}}>{manaSyms.slice(0,5).map((s,i)=><ManaSymbol key={i} sym={s} size={d.fs+5}/>)}</div>
          </div>
          <div style={{background:`${border}22`,border:`1px solid ${border}44`,borderRadius:3,flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:border,fontSize:d.fs+4}}>{type}</div>
          <div style={{fontSize:d.fs,color:"#777",lineHeight:1.1}}>{card.type_line?.split("—")[0]?.trim()}</div>
          <div style={{fontSize:d.fs-1,color:"#555",lineHeight:1.2,overflow:"hidden",maxHeight:38}}>{(card.oracle_text||"").slice(0,80)}{(card.oracle_text||"").length>80?"…":""}</div>
          {card.power&&<div style={{alignSelf:"flex-end",background:"#222",border:`1px solid ${border}55`,borderRadius:3,padding:"1px 5px",fontSize:d.fs,color:"#ddd"}}>{card.power}/{card.toughness}</div>}
        </div>
      }
      {(p1>0||m1>0)&&<div style={{position:"absolute",bottom:3,right:3,display:"flex",gap:2}}>
        {p1>0&&<span style={{background:"#1a4a1a",border:"1px solid #3acc3a",borderRadius:3,color:"#80ff80",fontSize:8,padding:"1px 4px",fontFamily:"'Cinzel',serif"}}>+{p1}/+{p1}</span>}
        {m1>0&&<span style={{background:"#4a1a1a",border:"1px solid #cc3a3a",borderRadius:3,color:"#ff8080",fontSize:8,padding:"1px 4px",fontFamily:"'Cinzel',serif"}}>-{m1}/-{m1}</span>}
      </div>}
      {tapped&&<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.22)",borderRadius:5}}/>}
      {summoningSick&&isCreature(card)&&<div style={{position:"absolute",top:2,left:2,fontSize:8,background:"rgba(0,0,0,.75)",color:"#666",borderRadius:3,padding:"1px 4px",fontFamily:"monospace"}}>sick</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CARD TOOLTIP
// ═══════════════════════════════════════════════════════════════════════
function CardTooltip({card,x,y}){
  if(!card) return null;
  const img=card.image_uris?.normal||card.card_faces?.[0]?.image_uris?.normal;
  const vx=Math.min(x+18,window.innerWidth-240),vy=Math.min(y-10,window.innerHeight-320);
  return(
    <div style={{position:"fixed",left:vx,top:vy,zIndex:9999,pointerEvents:"none",filter:"drop-shadow(0 8px 32px rgba(0,0,0,.9))"}}>
      {img?<img src={img} alt={card.name} style={{width:220,borderRadius:11}}/>
        :<div style={{width:195,background:"#0d0d1a",border:"2px solid #2a2a4a",borderRadius:10,padding:12,color:"#ddd",fontSize:11,fontFamily:"'Cinzel',serif",lineHeight:1.5}}>
          <div style={{fontWeight:700,marginBottom:4,color:"#c8a800"}}>{card.name}</div>
          <div style={{color:"#666",marginBottom:5,fontSize:10}}>{card.type_line}</div>
          <div style={{color:"#999"}}>{card.oracle_text}</div>
          {card.power&&<div style={{marginTop:6,textAlign:"right",fontWeight:700}}>{card.power}/{card.toughness}</div>}
        </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MANA POOL
// ═══════════════════════════════════════════════════════════════════════
function ManaPool({pool,onChange}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      {["W","U","B","R","G","C"].map(c=>(
        <div key={c} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          <ManaSymbol sym={c} size={17}/>
          <div style={{display:"flex",gap:1,alignItems:"center"}}>
            <button className="btn" onClick={()=>onChange(c,-1)} style={{width:13,height:13,borderRadius:"50%",border:"none",background:"#2a1a1a",color:"#f55",fontSize:10,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
            <span style={{fontSize:10,color:MANA_BG[c]||"#ddd",fontWeight:700,fontFamily:"'Cinzel',serif",minWidth:12,textAlign:"center"}}>{pool[c]||0}</span>
            <button className="btn" onClick={()=>onChange(c,1)} style={{width:13,height:13,borderRadius:"50%",border:"none",background:"#1a2a1a",color:"#5f5",fontSize:10,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LIFE COUNTER
// ═══════════════════════════════════════════════════════════════════════
function LifeCounter({life,onChange,label,color}){
  const [flash,setFlash]=useState(null);const prev=useRef(life);
  useEffect(()=>{if(life!==prev.current){setFlash(life<prev.current?"dmg":"heal");setTimeout(()=>setFlash(null),400);prev.current=life;};},[life]);
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <div style={{fontSize:8,color:"#444",letterSpacing:2,textTransform:"uppercase"}}>{label}</div>
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <button className="btn" onClick={()=>onChange(life-1)} style={{width:22,height:22,borderRadius:"50%",background:"#0d0d1a",border:"1px solid #1e1e2a",color:"#f55",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
        <span style={{fontSize:30,fontWeight:900,color:flash==="dmg"?"#ff3311":flash==="heal"?"#44ff44":color,fontFamily:"'Cinzel',serif",minWidth:44,textAlign:"center",textShadow:`0 0 16px ${color}44`,transition:"color .25s"}}>{life}</span>
        <button className="btn" onClick={()=>onChange(life+1)} style={{width:22,height:22,borderRadius:"50%",background:"#0d0d1a",border:"1px solid #1e1e2a",color:"#5f5",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DAMAGE FLOAT
// ═══════════════════════════════════════════════════════════════════════
function DmgFloat({events}){
  return(
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:8800}}>
      {events.map(e=>(
        <div key={e.id} style={{position:"absolute",left:e.x,top:e.y,color:e.v>0?"#ff4422":"#44ff66",fontSize:28,fontWeight:900,fontFamily:"'Cinzel',serif",textShadow:"0 0 12px currentColor",animation:"dmgFloat 1.1s ease-out forwards"}}>{e.v>0?`-${e.v}`:`+${Math.abs(e.v)}`}</div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════
function CtxMenu({x,y,options,onClose}){
  useEffect(()=>{const t=setTimeout(()=>window.addEventListener("mousedown",onClose),60);return()=>{clearTimeout(t);window.removeEventListener("mousedown",onClose);};},[onClose]);
  return(
    <div style={{position:"fixed",left:Math.min(x,window.innerWidth-185),top:Math.min(y,window.innerHeight-240),zIndex:9998,background:"#0a0a18",border:"1px solid #252540",borderRadius:8,overflow:"hidden",boxShadow:"0 8px 36px rgba(0,0,0,.88)",minWidth:175,animation:"fadeIn .1s ease"}}>
      {options.map((o,i)=>(
        <button key={i} className="btn" onClick={()=>{o.action();onClose();}}
          style={{display:"block",width:"100%",padding:"9px 14px",textAlign:"left",background:"none",border:"none",borderBottom:i<options.length-1?"1px solid #151525":"none",color:o.danger?"#ff5544":o.hi?"#c8a800":"#ccc",fontSize:12,cursor:"pointer",fontFamily:"'Crimson Pro',serif"}}
          onMouseOver={e=>e.currentTarget.style.background="#181830"}
          onMouseOut={e=>e.currentTarget.style.background="none"}
        >{o.label}</button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ZONE MODAL
// ═══════════════════════════════════════════════════════════════════════
function ZoneModal({zoneName,cards,onClose,onReturn}){
  const [tt,setTt]=useState({card:null,x:0,y:0});
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:9990,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#0a0a18",border:"1px solid #252540",borderRadius:12,padding:20,maxWidth:680,maxHeight:"78vh",width:"92%",overflow:"hidden",display:"flex",flexDirection:"column",gap:12,animation:"slideUp .2s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontFamily:"'Cinzel',serif",fontSize:15,color:"#c8a800",textTransform:"capitalize"}}>{zoneName} ({cards.length})</span>
          <button className="btn" onClick={onClose} style={{background:"none",border:"none",color:"#555",fontSize:20,cursor:"pointer"}}>×</button>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,overflowY:"auto",padding:4,minHeight:100}}>
          {cards.length===0&&<div style={{width:"100%",textAlign:"center",color:"#222",fontSize:12,padding:30,fontFamily:"'Cinzel',serif",letterSpacing:3}}>EMPTY</div>}
          {cards.map(inst=>(
            <div key={inst.uid} onMouseEnter={e=>setTt({card:inst.card,x:e.clientX,y:e.clientY})} onMouseMove={e=>setTt(t=>({...t,x:e.clientX,y:e.clientY}))} onMouseLeave={()=>setTt({card:null,x:0,y:0})}>
              <MTGCard card={inst.card} size="small" onClick={()=>onReturn&&onReturn(inst)}/>
            </div>
          ))}
        </div>
        {onReturn&&<div style={{fontSize:10,color:"#333",textAlign:"center",fontStyle:"italic"}}>Click card to return to hand</div>}
      </div>
      {tt.card&&<CardTooltip card={tt.card} x={tt.x} y={tt.y}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TOKEN MODAL
// ═══════════════════════════════════════════════════════════════════════
function TokenModal({onCreate,onClose}){
  const [name,setName]=useState("Creature Token");const[pw,setPw]=useState("1");const[tg,setTg]=useState("1");const[col,setCol]=useState("C");
  const go=()=>{onCreate({id:`tok-${uid()}`,name,type_line:"Token Creature",mana_cost:`{${col}}`,oracle_text:"",power:pw,toughness:tg,image_uris:null});onClose();};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:9991,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#0a0a18",border:"1px solid #252540",borderRadius:12,padding:24,width:290,display:"flex",flexDirection:"column",gap:13,animation:"slideUp .18s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:15,color:"#c8a800"}}>Create Token</div>
        {[["Name",name,setName],["Power",pw,setPw],["Toughness",tg,setTg]].map(([lbl,val,set])=>(
          <div key={lbl} style={{display:"flex",flexDirection:"column",gap:4}}>
            <label style={{fontSize:9,color:"#444",letterSpacing:2,textTransform:"uppercase"}}>{lbl}</label>
            <input value={val} onChange={e=>set(e.target.value)} style={{padding:"6px 10px",background:"#060610",border:"1px solid #1e1e3a",borderRadius:5,color:"#ddd",fontSize:12,fontFamily:"'Crimson Pro',serif",outline:"none"}}/>
          </div>
        ))}
        <div>
          <label style={{fontSize:9,color:"#444",letterSpacing:2,textTransform:"uppercase",display:"block",marginBottom:6}}>Color</label>
          <div style={{display:"flex",gap:7}}>{["W","U","B","R","G","C"].map(c=>(
            <div key={c} onClick={()=>setCol(c)} style={{cursor:"pointer",opacity:col===c?1:.3,transition:"opacity .12s"}}><ManaSymbol sym={c} size={22}/></div>
          ))}</div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button className="btn" onClick={onClose} style={{padding:"7px 13px",borderRadius:5,background:"#141420",border:"1px solid #252535",color:"#777",fontSize:11,cursor:"pointer"}}>Cancel</button>
          <button className="btn" onClick={go} style={{padding:"7px 15px",borderRadius:5,background:"#1a3a1a",border:"1px solid #3acc3a",color:"#80ff80",fontSize:11,cursor:"pointer",fontFamily:"'Cinzel',serif"}}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GAME OVER
// ═══════════════════════════════════════════════════════════════════════
function GameOver({winner,onRestart,onMenu}){
  const win=winner==="you";
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.94)",zIndex:9995,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",animation:"slideUp .4s ease"}}>
        <div style={{fontSize:60,marginBottom:14}}>{win?"🏆":"💀"}</div>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:52,fontWeight:900,color:win?"#c8a800":"#c04030",textShadow:`0 0 40px ${win?"#c8a80077":"#c0403077"}`,letterSpacing:".05em"}}>{win?"VICTORY":"DEFEAT"}</div>
        <div style={{color:"#444",margin:"10px 0 36px",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",fontSize:15}}>{win?"The battlefield is yours.":"Your forces have fallen."}</div>
        <div style={{display:"flex",gap:12,justifyContent:"center"}}>
          <button className="btn" onClick={onRestart} style={{padding:"11px 26px",borderRadius:7,background:"#1a3a1a",border:"1px solid #3acc3a",color:"#80ff80",fontSize:13,cursor:"pointer",fontFamily:"'Cinzel',serif"}}>Play Again</button>
          <button className="btn" onClick={onMenu} style={{padding:"11px 26px",borderRadius:7,background:"#1a1a3a",border:"1px solid #3a3a7a",color:"#8ab4ff",fontSize:13,cursor:"pointer",fontFamily:"'Cinzel',serif"}}>Main Menu</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// AI OPPONENT
// ═══════════════════════════════════════════════════════════════════════
function aiTurn(opp,playerGs,addLog){
  let g={...playerGs,opp:{...opp}};
  g.opp={...g.opp,battlefield:[...g.opp.battlefield.map(c=>({...c,tapped:false,summoningSick:false,attacking:false}))]};

  // Draw
  if(g.opp.library.length){
    const[d,...rest]=g.opp.library; g.opp={...g.opp,library:rest,hand:[...g.opp.hand,d]};
    addLog("Opponent draws.","opp");
  } else { addLog("Opponent's library empty — you win!","system"); return{gs:g,over:"you"}; }

  // Play land
  const land=g.opp.hand.find(i=>isLand(i.card));
  if(land){
    applyCardEffect(land.card,{...g,battlefield:g.opp.battlefield,hand:g.opp.hand,library:g.opp.library,graveyard:g.opp.graveyard,mana:g.opp.mana||{W:0,U:0,B:0,R:0,G:0,C:0}},"opp");
    g.opp={...g.opp,hand:g.opp.hand.filter(i=>i.uid!==land.uid),battlefield:[...g.opp.battlefield,{...land,tapped:false,summoningSick:false}]};
    addLog(`Opponent plays ${land.card.name}.`,"opp");
  }

  // Play spells
  const landCnt=g.opp.battlefield.filter(i=>isLand(i.card)).length;
  let mLeft=landCnt;
  const sorted=[...g.opp.hand].sort((a,b)=>cmc(a.card.mana_cost)-cmc(b.card.mana_cost));
  for(const inst of sorted){
    if(isLand(inst.card)) continue;
    const cost=cmc(inst.card.mana_cost||"");
    if(cost<=mLeft){
      mLeft-=cost;
      // Apply card effect from opponent's side
      const effResult=applyCardEffect(inst.card,g,"opp");
      g=effResult.gs;
      effResult.messages.forEach(m=>addLog(m.text,m.type));
      // Put non-instant/sorcery on battlefield
      if(!isInstant(inst.card)&&!isSorcery(inst.card)){
        g.opp={...g.opp,hand:g.opp.hand.filter(i=>i.uid!==inst.uid),battlefield:[...g.opp.battlefield,{...inst,tapped:false,summoningSick:true}]};
      } else {
        g.opp={...g.opp,hand:g.opp.hand.filter(i=>i.uid!==inst.uid),graveyard:[...g.opp.graveyard,inst]};
      }
      addLog(`Opponent casts ${inst.card.name}.`,"opp");
    }
  }

  // Attack
  const attackers=g.opp.battlefield.filter(i=>isCreature(i.card)&&!i.tapped&&!i.summoningSick);
  const totalDmg=attackers.reduce((s,a)=>s+(parseInt(a.card.power)||0),0);
  if(attackers.length){
    g.opp={...g.opp,battlefield:g.opp.battlefield.map(i=>attackers.find(a=>a.uid===i.uid)?{...i,tapped:true,attacking:true}:i)};
    addLog(`Opponent attacks for ${totalDmg} damage!`,"combat");
  }
  g.opp={...g.opp,battlefield:g.opp.battlefield.map(i=>({...i,summoningSick:false,attacking:false}))};
  return{gs:g,dmg:totalDmg,over:null};
}

// ═══════════════════════════════════════════════════════════════════════
// CARD SEARCH
// ═══════════════════════════════════════════════════════════════════════
function CardSearch({onAdd}){
  const [q,setQ]=useState("");const[res,setRes]=useState([]);const[loading,setLoading]=useState(false);const[err,setErr]=useState("");const[tt,setTt]=useState({card:null,x:0,y:0});
  const dRef=useRef(null);
  const search=useCallback(async query=>{
    if(!query.trim()){setRes([]);return;}setLoading(true);setErr("");
    try{const r=await fetch(`${SCRYFALL_SEARCH}?q=${encodeURIComponent(query)}&unique=cards&order=name`);const d=await r.json();
      if(d.object==="error"){setRes([]);setErr("No results.");}else setRes(d.data?.slice(0,22)||[]);
    }catch{setErr("Search failed.");}setLoading(false);
  },[]);
  useEffect(()=>{clearTimeout(dRef.current);dRef.current=setTimeout(()=>search(q),480);return()=>clearTimeout(dRef.current);},[q,search]);
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:9}}>
      <div style={{position:"relative"}}>
        <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"#333",fontSize:12}}>🔍</span>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search Scryfall…" style={{width:"100%",padding:"8px 10px 8px 28px",background:"#060610",border:"1px solid #1a1a2e",borderRadius:6,color:"#ccc",fontSize:12,fontFamily:"'Crimson Pro',serif",outline:"none",boxSizing:"border-box"}}
          onFocus={e=>e.target.style.borderColor="#3a3a6a"} onBlur={e=>e.target.style.borderColor="#1a1a2e"}/>
      </div>
      {loading&&<div style={{color:"#333",fontSize:11,textAlign:"center",fontStyle:"italic"}}>Searching…</div>}
      {err&&<div style={{color:"#f554",fontSize:11}}>{err}</div>}
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:3}}>
        {res.map(card=>(
          <div key={card.id} onMouseEnter={e=>setTt({card,x:e.clientX,y:e.clientY})} onMouseMove={e=>setTt(t=>({...t,x:e.clientX,y:e.clientY}))} onMouseLeave={()=>setTt({card:null,x:0,y:0})}
            style={{display:"flex",alignItems:"center",gap:7,padding:"5px 7px",borderRadius:5,background:"#060610",border:"1px solid #111120",transition:"border-color .12s",cursor:"default"}}
            onMouseOver={e=>e.currentTarget.style.borderColor="#3a3a6a"} onMouseOut={e=>e.currentTarget.style.borderColor="#111120"}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:"#ccc",fontFamily:"'Cinzel',serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.name}</div>
              <div style={{fontSize:9,color:"#444",marginTop:1}}>{card.type_line?.slice(0,36)}</div>
            </div>
            <div style={{display:"flex",gap:1}}>{parseMana(card.mana_cost||"").slice(0,5).map((s,i)=><ManaSymbol key={i} sym={s} size={12}/>)}</div>
            <button className="btn" onClick={()=>onAdd(card)} style={{padding:"3px 8px",borderRadius:4,fontSize:9,background:"#12204a",border:"1px solid #2a4a8a",color:"#7aabff",cursor:"pointer",fontFamily:"'Cinzel',serif",whiteSpace:"nowrap"}}>+Deck</button>
          </div>
        ))}
      </div>
      {tt.card&&<CardTooltip card={tt.card} x={tt.x} y={tt.y}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DECK LIST
// ═══════════════════════════════════════════════════════════════════════
function DeckList({deck,onRemove,onClear,onPlay}){
  const grouped=deck.reduce((a,c)=>{a[c.id]=a[c.id]||{card:c,count:0};a[c.id].count++;return a},{});
  const groups=Object.values(grouped);
  const creatures=groups.filter(g=>isCreature(g.card));
  const lands=groups.filter(g=>isLand(g.card));
  const spells=groups.filter(g=>!isCreature(g.card)&&!isLand(g.card));
  const Sec=({title,items,col})=>items.length===0?null:(
    <div style={{marginBottom:7}}>
      <div style={{fontSize:8,color:col||"#444",letterSpacing:2,textTransform:"uppercase",padding:"4px 0 2px",borderBottom:"1px solid #0d0d18",marginBottom:2}}>{title} <span style={{color:"#333"}}>{items.reduce((s,g)=>s+g.count,0)}</span></div>
      {items.map(({card,count})=>(
        <div key={card.id} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 3px",borderRadius:3,marginBottom:1}}>
          <span style={{fontSize:9,color:"#333",width:14,textAlign:"right"}}>{count}×</span>
          <span style={{flex:1,fontSize:9,color:"#aaa",fontFamily:"'Cinzel',serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.name}</span>
          <div style={{display:"flex",gap:1}}>{parseMana(card.mana_cost||"").slice(0,4).map((s,i)=><ManaSymbol key={i} sym={s} size={10}/>)}</div>
          <button className="btn" onClick={()=>onRemove(card.id)} style={{background:"none",border:"none",color:"#f554",cursor:"pointer",fontSize:12,padding:"0 2px"}}>×</button>
        </div>
      ))}
    </div>
  );
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",gap:7}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <span style={{fontSize:10,color:"#444",fontFamily:"'Cinzel',serif"}}>{deck.length} cards</span>
        <div style={{display:"flex",gap:5}}>
          {deck.length>=7&&<button className="btn" onClick={onPlay} style={{padding:"4px 10px",borderRadius:4,fontSize:10,background:"#1a3a1a",border:"1px solid #3acc3a",color:"#80ff80",cursor:"pointer",fontFamily:"'Cinzel',serif"}}>▶ Play</button>}
          <button className="btn" onClick={onClear} style={{padding:"4px 8px",borderRadius:4,fontSize:10,background:"#2a1a1a",border:"1px solid #4a2020",color:"#f554",cursor:"pointer"}}>Clear</button>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        <Sec title="Creatures" items={creatures} col="#3a8a3a"/>
        <Sec title="Spells" items={spells} col="#3a8fd8"/>
        <Sec title="Lands" items={lands} col="#c8a800"/>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GAME LOG
// ═══════════════════════════════════════════════════════════════════════
function Log({entries}){
  const ref=useRef(null);
  useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[entries]);
  const cols={system:"#3a7a3a",damage:"#c04030",heal:"#30a050",combat:"#c8a800",action:"#3a5a88",opp:"#7a3a8a"};
  return(
    <div ref={ref} style={{height:88,overflowY:"auto",padding:"5px 10px",background:"#030307",borderTop:"1px solid #0a0a15",display:"flex",flexDirection:"column",gap:1,flexShrink:0}}>
      {entries.slice(-40).map((e,i)=>(
        <div key={i} style={{fontSize:9,color:cols[e.type]||"#334",fontFamily:"monospace",lineHeight:1.4}}>
          <span style={{color:"#1a1a25",marginRight:5}}>{e.time}</span>{e.text}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HERO SELECT SCREEN
// ═══════════════════════════════════════════════════════════════════════
function HeroSelect({playerLabel,onSelect,onBack}){
  const [hovered,setHovered]=useState(null);
  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"radial-gradient(ellipse at 50% 0%,rgba(40,10,80,.9),transparent 60%),#04040c",padding:24,fontFamily:"'Cinzel',serif"}}>
      <div style={{fontSize:11,color:"#555",letterSpacing:4,textTransform:"uppercase",marginBottom:8}}>Choose Your Hero</div>
      <h2 style={{fontSize:28,fontWeight:900,color:"#c8a800",marginBottom:4,letterSpacing:3}}>{playerLabel}</h2>
      <p style={{fontSize:11,color:"#334",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",marginBottom:36}}>Your hero grants a passive ability and a once-per-turn active power.</p>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",justifyContent:"center",maxWidth:900}}>
        {HEROES.map(h=>(
          <div key={h.id}
            onMouseEnter={()=>setHovered(h.id)}
            onMouseLeave={()=>setHovered(null)}
            onClick={()=>onSelect(h)}
            style={{
              width:160,padding:"20px 16px",borderRadius:12,cursor:"pointer",
              background:hovered===h.id?`linear-gradient(160deg,${h.color}22,${h.color}0a)`:"linear-gradient(160deg,#0d0d1a,#06060e)",
              border:`2px solid ${hovered===h.id?h.color:h.color+"44"}`,
              boxShadow:hovered===h.id?`0 0 24px ${h.color}44`:"none",
              transition:"all .2s",transform:hovered===h.id?"translateY(-6px)":"none",
              display:"flex",flexDirection:"column",alignItems:"center",gap:10,
            }}>
            <div style={{fontSize:44}}>{h.icon}</div>
            <div style={{fontSize:14,fontWeight:700,color:h.color,letterSpacing:2,textAlign:"center"}}>{h.name}</div>
            <div style={{fontSize:9,color:"#555",letterSpacing:1,textAlign:"center",fontFamily:"'Crimson Pro',serif",fontStyle:"italic"}}>{h.title}</div>
            <div style={{width:"100%",height:1,background:`${h.color}33`}}/>
            <div style={{fontSize:9,color:"#888",fontFamily:"'Crimson Pro',serif",lineHeight:1.5,textAlign:"center"}}>
              <span style={{color:h.color,fontWeight:700}}>Passive: </span>{h.passive}
            </div>
            <div style={{fontSize:9,color:"#888",fontFamily:"'Crimson Pro',serif",lineHeight:1.5,textAlign:"center"}}>
              <span style={{color:"#c8a800",fontWeight:700}}>Active: </span>{h.active}
            </div>
          </div>
        ))}
      </div>
      <button className="btn" onClick={onBack} style={{marginTop:32,padding:"8px 20px",borderRadius:6,background:"none",border:"1px solid #222",color:"#444",fontSize:11,cursor:"pointer"}}>← Back</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HERO BADGE (in-game)
// ═══════════════════════════════════════════════════════════════════════
function HeroBadge({hero,used,onActivate,label}){
  if(!hero) return null;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <div style={{fontSize:8,color:"#444",letterSpacing:2,textTransform:"uppercase"}}>{label}</div>
      <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:6,background:`${hero.color}11`,border:`1px solid ${hero.color}33`}}>
        <span style={{fontSize:16}}>{hero.icon}</span>
        <div style={{display:"flex",flexDirection:"column"}}>
          <span style={{fontSize:9,color:hero.color,fontFamily:"'Cinzel',serif",fontWeight:700}}>{hero.name}</span>
          <span style={{fontSize:7,color:"#444",fontFamily:"'Crimson Pro',serif"}}>{hero.passive.slice(0,30)}…</span>
        </div>
        {onActivate&&(
          <button className="btn" onClick={onActivate} disabled={used} style={{
            padding:"3px 8px",borderRadius:4,fontSize:8,cursor:used?"not-allowed":"pointer",
            background:used?"#1a1a1a":`${hero.color}22`,
            border:`1px solid ${used?"#222":hero.color}`,
            color:used?"#333":hero.color,fontFamily:"'Cinzel',serif",
            whiteSpace:"nowrap",
          }}>{used?"Used":"⚡ Active"}</button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MODE SELECT (1P vs AI  |  2P Local Hot-Seat)
// ═══════════════════════════════════════════════════════════════════════
function ModeSelect({deck,onMode,onBack}){
  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#04040c",padding:24,fontFamily:"'Cinzel',serif"}}>
      <div style={{fontSize:76,marginBottom:12}}>🃏</div>
      <h2 style={{fontSize:32,fontWeight:900,color:"#c8a800",letterSpacing:3,marginBottom:8}}>Choose Mode</h2>
      <p style={{fontSize:11,color:"#334",fontFamily:"'Crimson Pro',serif",marginBottom:40}}>How do you want to play?</p>
      <div style={{display:"flex",gap:20,flexWrap:"wrap",justifyContent:"center"}}>
        <div onClick={()=>onMode("1p")} style={{width:220,padding:28,borderRadius:14,cursor:"pointer",background:"linear-gradient(160deg,#1a1a3a,#0d0d20)",border:"2px solid #3a3a7a",textAlign:"center",transition:"all .2s"}}
          onMouseOver={e=>{e.currentTarget.style.borderColor="#7a7acc";e.currentTarget.style.transform="translateY(-4px)";}}
          onMouseOut={e=>{e.currentTarget.style.borderColor="#3a3a7a";e.currentTarget.style.transform="none";}}>
          <div style={{fontSize:48,marginBottom:10}}>🤖</div>
          <div style={{fontSize:16,fontWeight:700,color:"#8ab4ff",marginBottom:6}}>vs AI</div>
          <div style={{fontSize:10,color:"#445",fontFamily:"'Crimson Pro',serif",lineHeight:1.5}}>Play against the computer. AI plays lands, casts spells, and attacks automatically.</div>
        </div>
        <div onClick={()=>onMode("2p")} style={{width:220,padding:28,borderRadius:14,cursor:"pointer",background:"linear-gradient(160deg,#1a2a1a,#0d180d)",border:"2px solid #3a7a3a",textAlign:"center",transition:"all .2s"}}
          onMouseOver={e=>{e.currentTarget.style.borderColor="#7acc7a";e.currentTarget.style.transform="translateY(-4px)";}}
          onMouseOut={e=>{e.currentTarget.style.borderColor="#3a7a3a";e.currentTarget.style.transform="none";}}>
          <div style={{fontSize:48,marginBottom:10}}>👥</div>
          <div style={{fontSize:16,fontWeight:700,color:"#80ff90",marginBottom:6}}>2 Players</div>
          <div style={{fontSize:10,color:"#334",fontFamily:"'Crimson Pro',serif",lineHeight:1.5}}>Hot-seat local play. Take turns on the same screen. Each player picks a Hero!</div>
        </div>
      </div>
      <button className="btn" onClick={onBack} style={{marginTop:32,padding:"8px 20px",borderRadius:6,background:"none",border:"1px solid #222",color:"#444",fontSize:11,cursor:"pointer"}}>← Back</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PASS SCREEN (2P hot-seat between turns)
// ═══════════════════════════════════════════════════════════════════════
function PassScreen({label,hero,onReady}){
  return(
    <div style={{position:"fixed",inset:0,background:"#02020a",zIndex:9996,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Cinzel',serif"}}>
      <div style={{fontSize:52,marginBottom:16}}>{hero?.icon||"🃏"}</div>
      <h2 style={{fontSize:36,fontWeight:900,color:hero?.color||"#c8a800",marginBottom:8,letterSpacing:3}}>{label}</h2>
      <p style={{color:"#444",fontSize:13,fontFamily:"'Crimson Pro',serif",fontStyle:"italic",marginBottom:12}}>Your turn begins now.</p>
      {hero&&<p style={{color:"#555",fontSize:11,fontFamily:"'Crimson Pro',serif",marginBottom:40}}>Hero: {hero.name} — {hero.passive}</p>}
      <button className="btn" onClick={onReady} style={{padding:"14px 40px",borderRadius:8,background:`linear-gradient(135deg,${hero?.color||"#c8a800"}22,${hero?.color||"#c8a800"}11)`,border:`2px solid ${hero?.color||"#c8a800"}`,color:hero?.color||"#c8a800",fontSize:14,cursor:"pointer",letterSpacing:3}}>
        I'M READY →
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LANDING PAGE
// ═══════════════════════════════════════════════════════════════════════
function Landing({deck,onDeckBuilder,onSelectMode,onLoadStarter,starterLoading}){
  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      background:"radial-gradient(ellipse at 20% 80%,rgba(40,0,80,.9) 0%,transparent 50%),radial-gradient(ellipse at 80% 20%,rgba(0,30,80,.9) 0%,transparent 50%),radial-gradient(ellipse at 50% 50%,rgba(80,30,0,.4) 0%,transparent 60%),#04040c",
      padding:24,position:"relative",overflow:"hidden",fontFamily:"'Cinzel',serif"}}>
    {[...Array(22)].map((_,i)=>(
      <div key={i} style={{position:"absolute",left:`${5+Math.random()*90}%`,top:`${5+Math.random()*90}%`,width:i%3===0?3:2,height:i%3===0?3:2,borderRadius:"50%",background:["#3a8fd8","#c8a800","#e05520","#3a8a3a","#8a4a9a"][i%5],opacity:.2+Math.random()*.5,animation:`pulse ${2+Math.random()*3}s ease-in-out infinite`,animationDelay:`${Math.random()*4}s`}}/>
    ))}
    <div style={{fontSize:76,marginBottom:4,filter:"drop-shadow(0 0 28px rgba(200,168,0,.35))",animation:"pulse 4s ease-in-out infinite"}}>🃏</div>
    <h1 style={{fontSize:"clamp(40px,8vw,86px)",fontWeight:900,letterSpacing:".06em",marginBottom:6,background:"linear-gradient(135deg,#a07800,#e8c820,#f5e060,#b09000)",backgroundSize:"200% 100%",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",animation:"shimmer 5s linear infinite"}}>TapAndDraw</h1>
    <p style={{fontSize:12,color:"#4a6688",letterSpacing:4,textTransform:"uppercase",marginBottom:6}}>A Magic: The Gathering Game in a Browser</p>
    <p style={{fontSize:12,color:"#2a3444",fontFamily:"'Crimson Pro',serif",fontStyle:"italic",marginBottom:40,letterSpacing:1}}>Build decks. Draw cards. Control the battlefield.</p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center",marginBottom:22}}>
      <button className="btn" onClick={onDeckBuilder} style={{padding:"13px 30px",borderRadius:7,background:"linear-gradient(135deg,#1a2a5a,#2a3a7a)",border:"1px solid #3a5acc",color:"#8ab4ff",fontSize:12,cursor:"pointer",fontFamily:"'Cinzel',serif",letterSpacing:2,boxShadow:"0 4px 20px rgba(50,100,200,.22)"}}>🃏 Build Deck</button>
      {deck.length>=7&&<button className="btn" onClick={onSelectMode} style={{padding:"13px 30px",borderRadius:7,background:"linear-gradient(135deg,#1a4a1a,#2a7a2a)",border:"1px solid #3acc5a",color:"#80ff90",fontSize:12,cursor:"pointer",fontFamily:"'Cinzel',serif",letterSpacing:2,boxShadow:"0 4px 20px rgba(50,200,80,.22)"}}>▶ Play ({deck.length})</button>}
    </div>
    <div style={{marginBottom:22}}>
      <div style={{fontSize:8,color:"#222",letterSpacing:3,textTransform:"uppercase",textAlign:"center",marginBottom:10}}>Or load a starter deck</div>
      <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
        {STARTER_DECKS.map(sd=>(
          <button key={sd.name} className="btn" onClick={()=>onLoadStarter(sd)} disabled={!!starterLoading} style={{padding:"7px 14px",borderRadius:6,fontSize:10,background:`${sd.color}15`,border:`1px solid ${sd.color}44`,color:sd.color,cursor:starterLoading?"wait":"pointer",fontFamily:"'Cinzel',serif",opacity:starterLoading&&starterLoading!==sd.name?.45:1}}>
            {starterLoading===sd.name?"Loading…":`${sd.icon} ${sd.name}`}
          </button>
        ))}
      </div>
    </div>
    <div style={{display:"flex",gap:7,flexWrap:"wrap",justifyContent:"center",marginBottom:14}}>
      {["Real Scryfall Cards","AI Opponent","Spell Effects Engine","Combat","Mana Pool","Tokens & Counters"].map(f=>(
        <span key={f} style={{fontSize:8,padding:"3px 7px",borderRadius:10,background:"#0a0a18",border:"1px solid #111120",color:"#2a2a3a",letterSpacing:1,textTransform:"uppercase"}}>{f}</span>
      ))}
    </div>
    <p style={{position:"absolute",bottom:10,fontSize:8,color:"#141420",fontFamily:"'Crimson Pro',serif",textAlign:"center",maxWidth:460,padding:"0 16px",lineHeight:1.7}}>
      TapAndDraw is an independent fan project not affiliated with Wizards of the Coast LLC.<br/>Magic: The Gathering™ is a trademark of Wizards of the Coast LLC. Card data provided by Scryfall.
    </p>
  </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DECK BUILDER VIEW
// ═══════════════════════════════════════════════════════════════════════
function DeckBuilder({deck,onAdd,onRemove,onClear,onPlay,onBack}){
  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#04040c"}}>
      <div style={{padding:"10px 16px",display:"flex",alignItems:"center",gap:12,borderBottom:"1px solid #0a0a18",background:"#060610",flexShrink:0}}>
        <button className="btn" onClick={onBack} style={{background:"none",border:"none",color:"#333",cursor:"pointer",fontSize:17}}>←</button>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:15,fontWeight:700,color:"#c8a800"}}>TapAndDraw</span>
        <span style={{color:"#1a1a2a",fontSize:12}}>/</span>
        <span style={{fontSize:11,color:"#335",fontFamily:"'Cinzel',serif"}}>Deck Builder</span>
        <div style={{flex:1}}/>
        <span style={{fontSize:10,color:"#2a2a3a",fontFamily:"'Cinzel',serif"}}>{deck.length} / 60</span>
        {deck.length>=7&&<button className="btn" onClick={onPlay} style={{padding:"6px 16px",borderRadius:5,background:"#1a3a1a",border:"1px solid #3acc3a",color:"#80ff80",fontSize:11,cursor:"pointer",fontFamily:"'Cinzel',serif"}}>▶ Play</button>}
      </div>
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        <div style={{width:295,borderRight:"1px solid #0a0a18",padding:13,display:"flex",flexDirection:"column",gap:9}}>
          <div style={{fontSize:8,color:"#222",letterSpacing:3,textTransform:"uppercase",fontFamily:"'Cinzel',serif"}}>Search Cards</div>
          <CardSearch onAdd={onAdd}/>
        </div>
        <div style={{width:210,borderRight:"1px solid #0a0a18",padding:13,display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:8,color:"#222",letterSpacing:3,textTransform:"uppercase",fontFamily:"'Cinzel',serif"}}>Your Deck</div>
          <DeckList deck={deck} onRemove={onRemove} onClear={onClear} onPlay={onPlay}/>
        </div>
        <div style={{flex:1,padding:13,overflow:"auto",display:"flex",flexWrap:"wrap",gap:7,alignContent:"flex-start"}}>
          <div style={{width:"100%",fontSize:8,color:"#1a1a28",letterSpacing:3,textTransform:"uppercase",marginBottom:3,fontFamily:"'Cinzel',serif"}}>Preview</div>
          {[...new Map(deck.map(c=>[c.id,c])).values()].map(card=>(
            <MTGCard key={card.id} card={card} size="normal" onClick={()=>onAdd(card)}/>
          ))}
          {deck.length===0&&<div style={{color:"#111118",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:3,paddingTop:60,width:"100%",textAlign:"center"}}>SEARCH AND ADD CARDS</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HAND CARD (extracted so useState is legal)
// ═══════════════════════════════════════════════════════════════════════
function HandCard({inst,onPlay,onDiscard,onHover}){
  const [hov,setHov]=useState(false);
  return(
    <div draggable onDragStart={e=>e.dataTransfer.setData("handUid",inst.uid)}
      style={{flexShrink:0,transition:"transform .15s",transform:hov?"translateY(-18px)":"none"}}
      onMouseEnter={e=>{setHov(true);onHover({card:inst.card,x:e.clientX,y:e.clientY});}}
      onMouseMove={e=>onHover(t=>({...t,x:e.clientX,y:e.clientY}))}
      onMouseLeave={()=>{setHov(false);onHover({card:null,x:0,y:0});}}>
      <MTGCard card={inst.card} size="small" draggable onClick={()=>onPlay(inst)} onContextMenu={e=>{e.preventDefault();onDiscard(inst);}}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GAME VIEW
// ═══════════════════════════════════════════════════════════════════════
function GameView({initGs,deck,onMenu,hero,oppHero,is2P,p2deck}){
  const [gs,setGs]=useState(initGs);
  const [phase,setPhase]=useState("Main 1");
  const [turn,setTurn]=useState(1);
  const [activePlayer,setActivePlayer]=useState(1); // 1P or 2P for hot-seat
  const [showPass,setShowPass]=useState(false);
  const [heroUsed,setHeroUsed]=useState(false); // active ability used this turn
  const [log,setLog]=useState([{text:"Game started! Drew 7 cards.",type:"system",time:nowStr()}]);
  const [ctx,setCtx]=useState(null);
  const [tt,setTt]=useState({card:null,x:0,y:0});
  const [zoneModal,setZoneModal]=useState(null);
  const [tokenModal,setTokenModal]=useState(false);
  const [dmgEvt,setDmgEvt]=useState([]);
  const [gameOver,setGO]=useState(null);
  const [combatMode,setCombat]=useState(false);
  const [toasts,setToasts]=useState([]);
  const aiProcessing=useRef(false);
  const currentHero = activePlayer===1 ? hero : oppHero;

  const addLog=useCallback((text,type="action")=>setLog(l=>[...l,{text,type,time:nowStr()}]),[]);

  const addToast=useCallback((text,type="action")=>{
    const id=uid();
    setToasts(t=>[...t.slice(-4),{id,text,type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3200);
  },[]);

  const spawnDmg=(v,isPlayer)=>{
    const id=uid();
    setDmgEvt(e=>[...e,{id,v,x:isPlayer?window.innerWidth*.42:window.innerWidth*.42,y:isPlayer?window.innerHeight*.65:window.innerHeight*.22}]);
    setTimeout(()=>setDmgEvt(e=>e.filter(ev=>ev.id!==id)),1300);
  };

  const checkOver=useCallback((life,oppLife)=>{
    if(oppLife<=0){setGO("you");addLog("Opponent's life hits 0 — Victory!","system");}
    else if(life<=0){setGO("opp");addLog("Your life hits 0 — Defeat!","damage");}
  },[addLog]);

  // Core: apply effect and sync state
  const resolveEffect=(card,currentGs,src="player")=>{
    const result=applyCardEffect(card,currentGs,src);
    result.messages.forEach(m=>{ addLog(m.text,m.type); addToast(m.text,m.type); });
    // Check win conditions
    if(result.gs.oppLife<=0) setTimeout(()=>setGO("you"),100);
    if(result.gs.life<=0)    setTimeout(()=>setGO("opp"),100);
    // Spawn damage floats
    if(currentGs.oppLife!==result.gs.oppLife&&result.gs.oppLife<currentGs.oppLife) spawnDmg(currentGs.oppLife-result.gs.oppLife,false);
    if(currentGs.life!==result.gs.life&&result.gs.life<currentGs.life) spawnDmg(currentGs.life-result.gs.life,true);
    if(currentGs.life!==result.gs.life&&result.gs.life>currentGs.life) spawnDmg(-(result.gs.life-currentGs.life),true);
    return result.gs;
  };

  const drawCard=useCallback(()=>{
    setGs(g=>{
      if(!g.library.length){addLog("Library empty — you lose!","damage");setGO("opp");return g;}
      const[drawn,...rest]=g.library;
      addLog(`Drew ${drawn.card.name}`);
      return{...g,library:rest,hand:[...g.hand,drawn]};
    });
  },[addLog]);

  // ── PLAY CARD ── (with effect resolution + hero passive)
  const playCard=inst=>{
    setGs(g=>{
      const card=inst.card;
      let newGs;
      if(isLand(card)){
        newGs=resolveEffect(card,g,"player");
        newGs={...newGs,hand:newGs.hand.filter(c=>c.uid!==inst.uid),battlefield:[...newGs.battlefield,{...inst,tapped:false,summoningSick:false}]};
      } else if(isInstant(card)||isSorcery(card)){
        newGs=resolveEffect(card,g,"player");
        newGs={...newGs,hand:newGs.hand.filter(c=>c.uid!==inst.uid),graveyard:[...newGs.graveyard,inst]};
      } else {
        const withOnBf={...g,hand:g.hand.filter(c=>c.uid!==inst.uid),battlefield:[...g.battlefield,{...inst,tapped:false,summoningSick:isCreature(card)}]};
        newGs=resolveEffect(card,withOnBf,"player");
      }
      // Hero passive
      if(currentHero?.applyPassive){
        const after=currentHero.applyPassive(newGs,card);
        if(after.heroLog){ addLog(after.heroLog,"system"); addToast(after.heroLog,"system"); }
        return after;
      }
      return newGs;
    });
  };

  const discardCard=inst=>{
    setGs(g=>({...g,hand:g.hand.filter(c=>c.uid!==inst.uid),graveyard:[...g.graveyard,inst]}));
    addLog(`Discarded ${inst.card.name}`,"action");
  };

  const handleDrop=e=>{
    const uid2=e.dataTransfer.getData("handUid");
    if(!uid2) return;
    setGs(g=>{
      const inst=g.hand.find(c=>c.uid===uid2);
      if(!inst) return g;
      if(isLand(inst.card)){
        const newGs=resolveEffect(inst.card,g,"player");
        return{...newGs,hand:newGs.hand.filter(c=>c.uid!==uid2),battlefield:[...newGs.battlefield,{...inst,tapped:false,summoningSick:false}]};
      }
      if(isInstant(inst.card)||isSorcery(inst.card)){
        const newGs=resolveEffect(inst.card,g,"player");
        return{...newGs,hand:newGs.hand.filter(c=>c.uid!==uid2),graveyard:[...newGs.graveyard,inst]};
      }
      const withOnBf={...g,hand:g.hand.filter(c=>c.uid!==uid2),battlefield:[...g.battlefield,{...inst,tapped:false,summoningSick:isCreature(inst.card)}]};
      return resolveEffect(inst.card,withOnBf,"player");
    });
  };

  // ── BATTLEFIELD CARD ACTIONS ──
  const handleCardAct=(action,inst,event)=>{
    if(action==="tap"){
      if(combatMode&&isCreature(inst.card)&&!inst.tapped&&!inst.summoningSick){
        setGs(g=>({...g,battlefield:g.battlefield.map(c=>c.uid===inst.uid?{...c,attacking:!c.attacking}:c)}));
        addLog(`${inst.attacking?"Withdrew":"Declared"} ${inst.card.name} as attacker`,"combat");
        return;
      }
      // Tapping a land adds mana
      if(isLand(inst.card)&&!inst.tapped){
        const manaMap={plains:"W",island:"U",swamp:"B",mountain:"R",forest:"G"};
        const basic=manaMap[inst.card.name.toLowerCase()];
        const addM=basic?{[basic]:1}:{};
        // Try to read from oracle text too
        const addMAtch=(inst.card.oracle_text||"").toLowerCase().match(/add \{([wubrg])\}/i);
        if(addMAtch) addM[addMAtch[1].toUpperCase()]=1;
        setGs(g=>({...g,mana:{...g.mana,...Object.fromEntries(Object.entries(addM).map(([k,v])=>[k,(g.mana[k]||0)+v]))},battlefield:g.battlefield.map(c=>c.uid===inst.uid?{...c,tapped:true}:c)}));
        const manaKey=basic||Object.keys(addM)[0]||"C";
        addLog(`Tapped ${inst.card.name} → {${manaKey}}`);
        addToast(`{${manaKey}} added to mana pool`,"action");
        return;
      }
      setGs(g=>({...g,battlefield:g.battlefield.map(c=>c.uid===inst.uid?{...c,tapped:!c.tapped}:c)}));
      addLog(`${inst.tapped?"Untapped":"Tapped"} ${inst.card.name}`);
    }
    if(action==="ctx"&&event){
      setCtx({x:event.clientX,y:event.clientY,options:[
        {label:"↩ Return to Hand",action:()=>{setGs(g=>({...g,battlefield:g.battlefield.filter(c=>c.uid!==inst.uid),hand:[...g.hand,inst]}));addLog(`${inst.card.name} → Hand`);}},
        {label:"💀 Graveyard",action:()=>{setGs(g=>({...g,battlefield:g.battlefield.filter(c=>c.uid!==inst.uid),graveyard:[...g.graveyard,inst]}));addLog(`${inst.card.name} → Graveyard`);},danger:true},
        {label:"🌀 Exile",action:()=>{setGs(g=>({...g,battlefield:g.battlefield.filter(c=>c.uid!==inst.uid),exile:[...g.exile,inst]}));addLog(`${inst.card.name} → Exile`);}},
        {label:"⬆ Add +1/+1",action:()=>{setGs(g=>({...g,battlefield:g.battlefield.map(c=>c.uid===inst.uid?{...c,counters:{...c.counters,"+1/+1":(c.counters["+1/+1"]||0)+1}}:c)}));addLog(`+1/+1 on ${inst.card.name}`);}},
        {label:"⬇ Add -1/-1",action:()=>{setGs(g=>({...g,battlefield:g.battlefield.map(c=>c.uid===inst.uid?{...c,counters:{...c.counters,"-1/-1":(c.counters["-1/-1"]||0)+1}}:c)}));addLog(`-1/-1 on ${inst.card.name}`);}},
        {label:"✨ Activate Ability",action:()=>{
          setGs(g=>resolveEffect(inst.card,{...g},"player"));
          addLog(`Activated ${inst.card.name}'s ability.`,"action");
        },hi:true},
        {label:"🗑 Remove",action:()=>{setGs(g=>({...g,battlefield:g.battlefield.filter(c=>c.uid!==inst.uid)}));addLog(`Removed ${inst.card.name}`);},danger:true},
      ]});
    }
    if(action==="zone") setZoneModal(inst.z);
  };

  const untapAll=()=>{setGs(g=>({...g,battlefield:g.battlefield.map(c=>({...c,tapped:false,summoningSick:false,attacking:false}))}));addLog("Untapped all permanents","system");};
  const adjMana=(c,d)=>setGs(g=>({...g,mana:{...g.mana,[c]:Math.max(0,(g.mana[c]||0)+d)}}));

  const resolveCombat=()=>{
    const attackers=gs.battlefield.filter(i=>i.attacking);
    const totalDmg=attackers.reduce((s,a)=>{
      let pw=parseInt(a.card.power)||0;
      pw+=a.counters["+1/+1"]||0; pw-=a.counters["-1/-1"]||0;
      // Trample: extra hits through
      if((a.card.oracle_text||"").toLowerCase().includes("trample")) pw=Math.max(pw,pw);
      return s+pw;
    },0);
    if(totalDmg>0) spawnDmg(totalDmg,false);
    setGs(g=>{
      let newOppLife=g.oppLife-totalDmg;
      // Lifelink
      const lifelinkers=attackers.filter(a=>(a.card.oracle_text||"").toLowerCase().includes("lifelink"));
      const lifelinked=lifelinkers.reduce((s,a)=>s+(parseInt(a.card.power)||0),0);
      const newLife=g.life+lifelinked;
      if(lifelinked>0){ addLog(`Lifelink: You gain ${lifelinked} life.`,"heal"); addToast(`Lifelink: +${lifelinked} life`,"heal"); }
      checkOver(newLife,newOppLife);
      return{...g,life:newLife,oppLife:newOppLife,battlefield:g.battlefield.map(c=>({...c,attacking:false,tapped:c.attacking?true:c.tapped}))};
    });
    addLog(totalDmg>0?`Combat: ${attackers.length} attacker(s) — ${totalDmg} damage!`:"No attackers.","combat");
    setCombat(false);
  };

  const doAITurn=useCallback(()=>{
    if(aiProcessing.current) return;
    aiProcessing.current=true;
    addLog("─── Opponent's Turn ───","opp");
    setTimeout(()=>{
      setGs(g=>{
        const result=aiTurn(g.opp,g,addLog);
        if(result.over){setGO(result.over);return g;}
        const newGs=result.gs;
        if(result.dmg>0) spawnDmg(result.dmg,true);
        checkOver(newGs.life,newGs.oppLife);
        return newGs;
      });
      aiProcessing.current=false;
    },700);
  },[addLog,checkOver]);

  // Hero active ability
  const heroActivate=()=>{
    if(!currentHero||heroUsed) return;
    setGs(g=>{
      const after=currentHero.applyActive(g);
      if(after.heroLog){ addLog(after.heroLog,"system"); addToast(after.heroLog,currentHero.id==="pyromancer"?"damage":"heal"); }
      if(after.oppLife<=0) setTimeout(()=>setGO("you"),100);
      if(after.life<=0)    setTimeout(()=>setGO("opp"),100);
      return after;
    });
    setHeroUsed(true);
  };

  const nextPhase=()=>{
    if(phase==="Combat"&&!combatMode){setCombat(true);addLog("Declare attackers — click creatures, then Next Phase.","combat");return;}
    if(phase==="Combat"&&combatMode){resolveCombat();setPhase("Main 2");return;}
    if(phase==="End"){
      if(is2P){
        // Hot-seat: swap sides
        setGs(g=>{
          // Swap life pools and battlefield sides
          return{
            ...g,
            life: g.oppLife,
            oppLife: g.life,
            hand: g.opp?.hand||[],
            library: g.opp?.library||[],
            battlefield: g.opp?.battlefield||[],
            graveyard: g.opp?.graveyard||[],
            mana:{W:0,U:0,B:0,R:0,G:0,C:0},
            opp:{
              hand: g.hand,
              library: g.library,
              battlefield: g.battlefield,
              graveyard: g.graveyard,
              life: g.oppLife,
            }
          };
        });
        const nextPlayer=activePlayer===1?2:1;
        setActivePlayer(nextPlayer);
        setHeroUsed(false);
        setCombat(false);
        setPhase("Untap");
        setTurn(t=>t+1);
        setShowPass(true);
        addLog(`─── Player ${nextPlayer}'s Turn ───`,"system");
      } else {
        doAITurn();
        setTimeout(()=>{setTurn(t=>t+1);setPhase("Untap");untapAll();drawCard();setHeroUsed(false);addLog(`─── Your Turn ${turn+1} ───`,"system");},1500);
      }
      return;
    }
    const nxt=PHASES[(PHASES.indexOf(phase)+1)%PHASES.length];
    setPhase(nxt);
    if(nxt==="Untap"){untapAll();drawCard();}
    addLog(`Phase: ${nxt}`,"system");
  };

  const createToken=tokenCard=>{
    const inst={...mkInst(tokenCard),summoningSick:false};
    setGs(g=>({...g,battlefield:[...g.battlefield,inst]}));
    addLog(`Created token: ${tokenCard.name}`,"action");
  };

  const restart=()=>{
    const s=shuffle([...deck]).map(card=>({uid:uid(),card}));
    const o=shuffle([...deck]).map(card=>({uid:uid(),card}));
    setGs({library:s.slice(7),hand:s.slice(0,7),battlefield:[],graveyard:[],exile:[],life:20,oppLife:20,mana:{W:0,U:0,B:0,R:0,G:0,C:0},opp:{library:o.slice(7),hand:o.slice(0,7),battlefield:[],graveyard:[],life:20}});
    setPhase("Main 1");setTurn(1);setLog([{text:"New game!",type:"system",time:nowStr()}]);setGO(null);setCombat(false);setToasts([]);
  };

  const phIdx=PHASES.indexOf(phase);

  return(
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#04040c",overflow:"hidden",position:"relative"}}>
      {/* TOP BAR */}
      <div style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:7,borderBottom:"1px solid #0a0a15",background:"#050510",flexShrink:0,flexWrap:"wrap"}}>
        <button className="btn" onClick={onMenu} style={{background:"none",border:"none",color:"#2a2a3a",cursor:"pointer",fontSize:16}}>←</button>
        <span style={{fontFamily:"'Cinzel',serif",fontSize:13,fontWeight:700,color:"#c8a800"}}>TapAndDraw</span>
        {is2P&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:currentHero?`${currentHero.color}22`:"#1a1a2a",border:`1px solid ${currentHero?.color||"#333"}44`,color:currentHero?.color||"#888",fontFamily:"'Cinzel',serif"}}>P{activePlayer} {currentHero?.icon||""}</span>}
        <span style={{fontSize:10,color:"#1e1e2e",fontFamily:"'Cinzel',serif"}}>· T{turn}</span>
        <div style={{display:"flex",gap:2,marginLeft:4}}>
          {PHASES.map((p,i)=>(
            <div key={p} style={{padding:"2px 6px",borderRadius:3,fontSize:8,fontFamily:"'Cinzel',serif",background:phase===p?"rgba(200,168,0,.12)":"transparent",border:`1px solid ${phase===p?"#c8a80066":"#0d0d18"}`,color:phase===p?"#c8a800":i<phIdx?"#1e1e2e":"#222"}}>
              {p}
            </div>
          ))}
        </div>
        <div style={{flex:1}}/>
        {currentHero&&<HeroBadge hero={currentHero} used={heroUsed} onActivate={heroActivate} label="Hero"/>}
        {currentHero&&<div style={{width:1,height:28,background:"#0d0d18"}}/>}
        <ManaPool pool={gs.mana} onChange={adjMana}/>
        <div style={{width:1,height:28,background:"#0d0d18"}}/>
        <LifeCounter life={gs.oppLife} label={is2P?`P${activePlayer===1?2:1}`:"Opponent"} color="#c05030" onChange={v=>{setGs(g=>({...g,oppLife:v}));if(v<=0)setGO("you");}}/>
        <div style={{width:1,height:28,background:"#0d0d18"}}/>
        <LifeCounter life={gs.life} label={is2P?`P${activePlayer}`:"You"} color="#3acc3a" onChange={v=>{setGs(g=>({...g,life:v}));if(v<=0)setGO("opp");}}/>
        <div style={{width:1,height:28,background:"#0d0d18"}}/>
        <button className="btn" onClick={drawCard} style={{padding:"4px 10px",borderRadius:4,background:"#0b1522",border:"1px solid #16304a",color:"#5a8aaa",fontSize:9,cursor:"pointer",fontFamily:"'Cinzel',serif"}}>Draw <span style={{color:"#2a4455"}}>{gs.library.length}</span></button>
        <button className="btn" onClick={()=>setTokenModal(true)} style={{padding:"4px 9px",borderRadius:4,background:"#131320",border:"1px solid #222238",color:"#7a6acc",fontSize:9,cursor:"pointer",fontFamily:"'Cinzel',serif"}}>Token</button>
        <button className="btn" onClick={nextPhase} style={{padding:"4px 11px",borderRadius:4,fontSize:9,cursor:"pointer",fontFamily:"'Cinzel',serif",background:combatMode?"linear-gradient(135deg,#4a1008,#7a1a08)":"linear-gradient(135deg,#152515,#1f451f)",border:combatMode?"1px solid #bb3311":"1px solid #306030",color:combatMode?"#ff7755":"#6aaa6a"}}>
          {combatMode?"⚔ Resolve Combat":"Next Phase →"}
        </button>
      </div>

      {/* BATTLEFIELD */}
      <div style={{flex:1,margin:"5px 5px 0",borderRadius:9,overflow:"hidden",display:"flex",flexDirection:"column",position:"relative",
        background:"radial-gradient(ellipse at 50% 100%,rgba(0,55,0,.18) 0%,transparent 55%),radial-gradient(ellipse at 50% 0%,rgba(0,0,45,.22) 0%,transparent 55%),#040410",
        border:"1px solid #0a0a18"}}>
        <div style={{position:"absolute",inset:0,pointerEvents:"none",backgroundImage:"linear-gradient(rgba(255,255,255,.01) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.01) 1px,transparent 1px)",backgroundSize:"54px 54px",borderRadius:8}}/>
        <div style={{position:"absolute",left:0,right:0,top:"40%",height:1,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent)"}}/>

        {/* Opponent area */}
        <div style={{flex:1,padding:"7px 10px",display:"flex",flexWrap:"wrap",gap:7,alignContent:"flex-start",position:"relative"}}>
          <div style={{width:"100%",fontSize:8,color:"#1e1e2a",letterSpacing:3,textTransform:"uppercase",marginBottom:2,display:"flex",justifyContent:"space-between",fontFamily:"'Cinzel',serif"}}>
            <span>Opponent · Battlefield ({gs.opp.battlefield.length})</span>
            <span>Hand: {gs.opp.hand.length} · Library: {gs.opp.library.length}</span>
          </div>
          {gs.opp.battlefield.map(inst=>(
            <div key={inst.uid} onMouseEnter={e=>setTt({card:inst.card,x:e.clientX,y:e.clientY})} onMouseMove={e=>setTt(t=>({...t,x:e.clientX,y:e.clientY}))} onMouseLeave={()=>setTt({card:null,x:0,y:0})}>
              <MTGCard card={inst.card} size="tiny" tapped={inst.tapped} attacking={inst.attacking}/>
            </div>
          ))}
          <div style={{position:"absolute",top:6,right:8,display:"flex",gap:2}}>
            {gs.opp.hand.map((_,i)=><div key={i} style={{width:32,height:44,borderRadius:3,background:"linear-gradient(135deg,#181830,#0d0d20)",border:"1px solid #1a1a2a"}}/>)}
          </div>
        </div>

        {/* Player area */}
        <div style={{flex:2,padding:"7px 10px",borderTop:"1px solid rgba(255,255,255,.03)",position:"relative",minHeight:150}}
          onDragOver={e=>e.preventDefault()} onDrop={handleDrop}>
          <div style={{fontSize:8,color:"#252528",letterSpacing:3,textTransform:"uppercase",marginBottom:4,fontFamily:"'Cinzel',serif",display:"flex",gap:8}}>
            <span>Your Battlefield ({gs.battlefield.length})</span>
            {combatMode&&<span style={{color:"#cc4411"}}>⚔ Click creatures to declare attackers</span>}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:7,alignContent:"flex-start"}}>
            {gs.battlefield.map(inst=>(
              <div key={inst.uid} onMouseEnter={e=>setTt({card:inst.card,x:e.clientX,y:e.clientY})} onMouseMove={e=>setTt(t=>({...t,x:e.clientX,y:e.clientY}))} onMouseLeave={()=>setTt({card:null,x:0,y:0})}>
                <MTGCard card={inst.card} size="small" tapped={inst.tapped} selected={inst.selected} attacking={inst.attacking} summoningSick={inst.summoningSick} counters={inst.counters}
                  onClick={()=>handleCardAct("tap",inst)}
                  onContextMenu={e=>{e.preventDefault();handleCardAct("ctx",inst,e);}}
                />
              </div>
            ))}
            {gs.battlefield.length===0&&<div style={{width:"100%",textAlign:"center",color:"#111116",fontSize:11,paddingTop:36,fontFamily:"'Cinzel',serif",letterSpacing:4}}>DRAG CARDS HERE · CLICK TO TAP · RIGHT-CLICK FOR OPTIONS</div>}
          </div>
          {/* Zone pills */}
          <div style={{position:"absolute",right:8,bottom:8,display:"flex",gap:5}}>
            {[{z:"graveyard",l:"GY",col:"#7a3a3a"},{z:"exile",l:"EX",col:"#6a3a8a"}].map(zp=>(
              <div key={zp.z} onClick={()=>setZoneModal(zp.z)} style={{width:38,height:50,borderRadius:4,border:`1px solid ${zp.col}33`,background:`${zp.col}0e`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,cursor:"pointer"}}>
                <span style={{fontSize:7,color:zp.col,letterSpacing:1}}>{zp.l}</span>
                <span style={{fontSize:13,color:zp.col,fontWeight:700}}>{gs[zp.z].length}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* HAND */}
      <div style={{height:145,background:"#030309",borderTop:"1px solid #0a0a14",display:"flex",alignItems:"flex-end",padding:"0 10px 9px",gap:5,overflowX:"auto",flexShrink:0,position:"relative"}}>
        <div style={{position:"absolute",top:5,left:10,fontSize:7,color:"#1a1a22",letterSpacing:3,textTransform:"uppercase",fontFamily:"'Cinzel',serif"}}>Hand · {gs.hand.length}</div>
        {gs.hand.map(inst=>(
          <HandCard key={inst.uid} inst={inst} onPlay={playCard} onDiscard={discardCard} onHover={setTt}/>
        ))}
        {gs.hand.length===0&&<div style={{flex:1,textAlign:"center",color:"#111116",paddingBottom:24,fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:3,alignSelf:"center"}}>NO CARDS IN HAND</div>}
      </div>

      {/* LOG */}
      <Log entries={log}/>

      {/* GLOBALS */}
      {tt.card&&<CardTooltip card={tt.card} x={tt.x} y={tt.y}/>}
      <DmgFloat events={dmgEvt}/>
      <EffectToast toasts={toasts}/>
      {ctx&&<CtxMenu x={ctx.x} y={ctx.y} options={ctx.options} onClose={()=>setCtx(null)}/>}
      {zoneModal&&<ZoneModal zoneName={zoneModal} cards={gs[zoneModal]||[]} onClose={()=>setZoneModal(null)}
        onReturn={zoneModal==="graveyard"?inst=>{setGs(g=>({...g,graveyard:g.graveyard.filter(c=>c.uid!==inst.uid),hand:[...g.hand,inst]}));addLog(`GY → Hand: ${inst.card.name}`);setZoneModal(null);}:null}/>}
      {tokenModal&&<TokenModal onCreate={createToken} onClose={()=>setTokenModal(false)}/>}
      {gameOver&&<GameOver winner={gameOver} onRestart={restart} onMenu={onMenu}/>}
      {showPass&&<PassScreen
        label={is2P?`Player ${activePlayer}'s Turn`:"Your Turn"}
        hero={currentHero}
        onReady={()=>{setShowPass(false);untapAll();drawCard();}}
      />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════
export default function TapAndDraw(){
  const [view,setView]   = useState("landing");  // landing|deckbuilder|mode|hero1|hero2|game
  const [deck,setDeck]   = useState([]);
  const [gs,setGs]       = useState(null);
  const [starterLoading,setSL] = useState(null);
  const [gameMode,setGameMode] = useState("1p");  // "1p" | "2p"
  const [hero1,setHero1] = useState(null);
  const [hero2,setHero2] = useState(null);

  // ── Deck management ──────────────────────────────────────────────────
  const addCard=card=>{
    const n=deck.filter(c=>c.id===card.id).length;
    if(!card.type_line?.includes("Basic")&&n>=4) return;
    setDeck(d=>[...d,card]);
  };
  const removeCard=id=>{
    setDeck(d=>{const i=d.map(c=>c.id).lastIndexOf(id);return i===-1?d:[...d.slice(0,i),...d.slice(i+1)];});
  };
  const clearDeck=()=>setDeck([]);

  const loadStarter=async sd=>{
    setSL(sd.name);
    try{
      const r=await fetch(`${SCRYFALL_SEARCH}?q=${sd.query}&unique=cards&order=cmc`);
      const data=await r.json();
      if(data.data){
        const cards=data.data.slice(0,20);
        const nd=[];
        cards.forEach(c=>{const copies=isLand(c)?4:3;for(let i=0;i<copies;i++)nd.push(c);});
        setDeck(nd.slice(0,40));
      }
    }catch(e){console.error(e);}
    setSL(null);
  };

  // ── Game init ─────────────────────────────────────────────────────────
  const launchGame=(h1,h2,mode)=>{
    if(deck.length<7) return;
    const s=shuffle([...deck]).map(card=>({uid:uid(),card}));
    const o=shuffle([...deck]).map(card=>({uid:uid(),card}));
    setGs({
      library:s.slice(7), hand:s.slice(0,7),
      battlefield:[], graveyard:[], exile:[],
      life:20, oppLife:20,
      mana:{W:0,U:0,B:0,R:0,G:0,C:0},
      opp:{library:o.slice(7),hand:o.slice(0,7),battlefield:[],graveyard:[],life:20},
    });
    setHero1(h1); setHero2(h2); setGameMode(mode);
    setView("game");
  };

  // ── Mode select handler ───────────────────────────────────────────────
  const handleMode=mode=>{
    setGameMode(mode);
    setView("hero1");  // always pick hero for P1
  };

  // ── Hero select handlers ──────────────────────────────────────────────
  const handleHero1=h=>{
    setHero1(h);
    if(gameMode==="2p") setView("hero2");
    else launchGame(h,null,"1p");
  };
  const handleHero2=h=>{
    setHero2(h);
    launchGame(hero1,h,"2p");
  };

  return(
    <>
      <style>{GCSS}</style>

      {view==="landing"&&(
        <Landing
          deck={deck}
          onDeckBuilder={()=>setView("deckbuilder")}
          onSelectMode={()=>setView("mode")}
          onLoadStarter={loadStarter}
          starterLoading={starterLoading}
        />
      )}

      {view==="deckbuilder"&&(
        <DeckBuilder
          deck={deck} onAdd={addCard} onRemove={removeCard}
          onClear={clearDeck} onPlay={()=>setView("mode")}
          onBack={()=>setView("landing")}
        />
      )}

      {view==="mode"&&(
        <ModeSelect deck={deck} onMode={handleMode} onBack={()=>setView("landing")}/>
      )}

      {view==="hero1"&&(
        <HeroSelect
          playerLabel={gameMode==="2p"?"Player 1 — Choose Your Hero":"Choose Your Hero"}
          onSelect={handleHero1}
          onBack={()=>setView("mode")}
        />
      )}

      {view==="hero2"&&(
        <HeroSelect
          playerLabel="Player 2 — Choose Your Hero"
          onSelect={handleHero2}
          onBack={()=>setView("hero1")}
        />
      )}

      {view==="game"&&gs&&(
        <GameView
          initGs={gs}
          deck={deck}
          onMenu={()=>setView("landing")}
          hero={hero1}
          oppHero={hero2}
          is2P={gameMode==="2p"}
        />
      )}
    </>
  );
}
