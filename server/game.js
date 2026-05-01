import { nanoid } from 'nanoid';
import { chamberCards, lootCards } from './cards.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const roomCode = () => nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, 'A');

export const rooms = new Map();

function makeDeck(defs, prefix) {
  return defs.map((card, i) => ({ ...clone(card), id: `${prefix}-${i}-${nanoid(5)}` }));
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function draw(deck, discard) {
  if (deck.length === 0 && discard.length > 0) deck.push(...shuffle(discard.splice(0)));
  return deck.shift() || null;
}
function activePlayer(game) { return game.players.find(p => p.id === game.activePlayerId); }
function playerById(game, id) { return game.players.find(p => p.id === id); }
function log(game, message) { game.log.unshift({ id:nanoid(6), message, at:Date.now() }); game.log = game.log.slice(0, 80); }
function randomTake(arr) { if (!arr.length) return null; return arr.splice(Math.floor(Math.random()*arr.length),1)[0]; }

export function createRoom(hostSocketId, hostName) {
  const code = roomCode();
  const room = {
    code,
    status: 'lobby',
    sockets: new Map(),
    game: {
      code,
      status: 'lobby',
      players: [],
      activePlayerId: null,
      phase: 'lobby',
      turn: 0,
      chamberDeck: [], chamberDiscard: [], lootDeck: [], lootDiscard: [],
      combat: null,
      log: [],
      chat: [],
      winnerId: null
    }
  };
  rooms.set(code, room);
  joinRoom(code, hostSocketId, hostName);
  return room;
}

export function joinRoom(code, socketId, name) {
  const room = rooms.get((code || '').toUpperCase());
  if (!room) throw new Error('Room not found.');
  let player = room.game.players.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!player) {
    if (room.game.players.length >= 3) throw new Error('This room already has 3 players.');
    player = {
      id: nanoid(8), name: name.trim().slice(0,22) || 'Mystery Buddy', socketId,
      connected: true, renown: 1, role: null, origin: null,
      hand: [], gear: {}, effects: { nextCombatBonus:0, nextCombatPenalty:0, escapePenalty:0, skipScavenge:false }
    };
    room.game.players.push(player);
    log(room.game, `${player.name} entered the dungeon group chat.`);
  }
  player.socketId = socketId; player.connected = true;
  room.sockets.set(socketId, player.id);
  return { room, player };
}

export function leaveSocket(socketId) {
  for (const room of rooms.values()) {
    const pid = room.sockets.get(socketId);
    if (pid) {
      room.sockets.delete(socketId);
      const p = playerById(room.game, pid);
      if (p) p.connected = false;
      return room;
    }
  }
  return null;
}

export function startGame(room) {
  const game = room.game;
  if (game.players.length !== 3) throw new Error('Dungeon Buddies needs exactly 3 players.');
  game.status = 'active'; game.phase = 'awaitingChamber'; game.turn = 1;
  game.activePlayerId = game.players[0].id;
  game.chamberDeck = shuffle(makeDeck(chamberCards, 'chamber'));
  game.lootDeck = shuffle(makeDeck(lootCards, 'loot'));
  game.chamberDiscard = []; game.lootDiscard = [];
  for (const p of game.players) {
    p.renown = 1; p.role = null; p.origin = null; p.hand = []; p.gear = {};
    p.effects = { nextCombatBonus:0, nextCombatPenalty:0, escapePenalty:0, skipScavenge:false };
    for (let i=0;i<3;i++) p.hand.push(draw(game.chamberDeck, game.chamberDiscard));
    for (let i=0;i<3;i++) p.hand.push(draw(game.lootDeck, game.lootDiscard));
  }
  log(game, `The run begins. ${activePlayer(game).name} acts first.`);
}

function gearBonus(p) {
  let bonus = Object.values(p.gear).reduce((n, c) => n + (c?.bonus || 0), 0);
  if (p.role === 'Tinker') bonus += Math.max(0, Object.values(p.gear).length - 2);
  if (p.origin === 'Stoneborn') bonus += 1;
  return bonus;
}
function combatTotals(game) {
  const c = game.combat; if (!c) return null;
  const attacker = playerById(game, c.attackerId);
  let hero = attacker.renown + gearBonus(attacker) + (attacker.effects.nextCombatBonus || 0) - (attacker.effects.nextCombatPenalty || 0);
  if (attacker.role === 'Brute' && !c.helperId) hero += 2;
  if (attacker.origin === 'Wildblood') {
    const rawThreat = c.threat.strength + c.mods.filter(m=>m.side==='threat').reduce((n,m)=>n+m.amount,0);
    if (rawThreat - hero >= 3) hero += 2;
  }
  if (c.helperId) {
    const helper = playerById(game, c.helperId);
    hero += helper.renown + gearBonus(helper);
  }
  hero += c.mods.filter(m=>m.side==='hero').reduce((n,m)=>n+m.amount,0);
  const threat = c.threat.strength + c.mods.filter(m=>m.side==='threat').reduce((n,m)=>n+m.amount,0);
  return { hero, threat, winning: hero >= threat };
}
function discardCard(game, card) {
  if (!card) return;
  if (card.id?.startsWith('loot')) game.lootDiscard.push(card); else game.chamberDiscard.push(card);
}
function removeFromHand(p, cardId) {
  const idx = p.hand.findIndex(c => c.id === cardId);
  if (idx < 0) throw new Error('Card not found in your hand.');
  return p.hand.splice(idx,1)[0];
}
function equipGear(p, card) {
  if (card.slot === 'twohand') {
    if (p.gear.hand || p.gear.hand2) throw new Error('Your hands are already full.');
    p.gear.hand = card; p.gear.hand2 = { ...card, paired:true, name:`${card.name} (grip)` };
    return;
  }
  if (card.slot === 'hand') {
    if (!p.gear.hand) p.gear.hand = card;
    else if (!p.gear.hand2) p.gear.hand2 = card;
    else throw new Error('Your hands are already full.');
    return;
  }
  if (p.gear[card.slot]) throw new Error(`You already have ${card.slot} gear equipped.`);
  p.gear[card.slot] = card;
}
function applyHex(game, target, card) {
  const e = card.effect || {};
  if (e.type === 'loseRenown') target.renown = Math.max(1, target.renown - e.amount);
  if (e.type === 'discardRandom') for(let i=0;i<e.amount;i++) discardCard(game, randomTake(target.hand));
  if (e.type === 'nextCombatPenalty') target.effects.nextCombatPenalty += e.amount;
  if (e.type === 'escapePenalty') target.effects.escapePenalty += e.amount;
  if (e.type === 'rivalsDrawChamber') game.players.filter(p=>p.id!==target.id).forEach(p=>{ const c=draw(game.chamberDeck, game.chamberDiscard); if(c) p.hand.push(c); });
}
function applyConsequence(game, player) {
  const t = game.combat?.threat;
  if (!t) return;
  if (t.consequence.includes('Discard 2')) { discardCard(game, randomTake(player.hand)); discardCard(game, randomTake(player.hand)); }
  else if (t.consequence.includes('Discard')) discardCard(game, randomTake(player.hand));
  if (t.consequence.includes('Lose 2')) player.renown = Math.max(1, player.renown - 2);
  else if (t.consequence.includes('Lose 1')) player.renown = Math.max(1, player.renown - 1);
  if (t.consequence.includes('Unequip')) {
    const keys = Object.keys(player.gear); if (keys.length) delete player.gear[keys[0]];
  }
  if (t.consequence.includes('Reset')) player.renown = 1;
  if (t.consequence.includes('rivals steals') || t.consequence.includes('steals')) {
    game.players.filter(p=>p.id!==player.id).forEach(r=>{ const c=randomTake(player.hand); if(c) r.hand.push(c); });
  }
}
function nextTurn(game) {
  const i = game.players.findIndex(p=>p.id===game.activePlayerId);
  game.activePlayerId = game.players[(i+1)%game.players.length].id;
  game.turn += 1; game.phase = 'awaitingChamber'; game.combat = null;
  const p = activePlayer(game);
  p.effects.nextCombatBonus = 0; p.effects.nextCombatPenalty = 0; p.effects.escapePenalty = 0;
  log(game, `${p.name}'s turn begins.`);
}

export function applyAction(room, actorId, action) {
  const game = room.game;
  if (game.status !== 'active') throw new Error('Game is not active.');
  const actor = playerById(game, actorId); if (!actor) throw new Error('Player not found.');
  const isActive = actorId === game.activePlayerId;

  if (action.type === 'openChamber') {
    if (!isActive || game.phase !== 'awaitingChamber') throw new Error('You cannot open a chamber right now.');
    const card = draw(game.chamberDeck, game.chamberDiscard); if (!card) throw new Error('No chamber cards remain.');
    log(game, `${actor.name} opens a chamber: ${card.name}.`);
    if (card.kind === 'threat') {
      game.combat = { attackerId: actor.id, threat: card, helperId:null, mods:[], escapeUsed:false };
      game.phase = 'combat';
      log(game, `${card.name} wants problems. Combat begins.`);
    } else if (card.kind === 'hex') {
      applyHex(game, actor, card); discardCard(game, card); game.phase = 'afterChamber';
      log(game, `${actor.name} gets hit by ${card.name}.`);
    } else {
      actor.hand.push(card); game.phase = 'afterChamber';
      log(game, `${actor.name} pockets ${card.name}.`);
    }
  }

  if (action.type === 'scavenge') {
    if (!isActive || game.phase !== 'afterChamber') throw new Error('You cannot scavenge right now.');
    if (actor.effects.skipScavenge) { actor.effects.skipScavenge=false; throw new Error('You lost your Scavenge option this turn.'); }
    const card = draw(game.lootDeck, game.lootDiscard); if (card) actor.hand.push(card);
    log(game, `${actor.name} scavenges for Loot.`); nextTurn(game);
  }

  if (action.type === 'endTurn') {
    if (!isActive || !['afterChamber','awaitingChamber'].includes(game.phase)) throw new Error('You cannot end now.');
    log(game, `${actor.name} ends their turn.`); nextTurn(game);
  }

  if (action.type === 'playCard') {
    const card = removeFromHand(actor, action.cardId);
    if (card.kind === 'gear') {
      if (!isActive || game.phase === 'combat') { actor.hand.push(card); throw new Error('Gear can be equipped on your turn outside combat.'); }
      equipGear(actor, card); log(game, `${actor.name} equips ${card.name}.`);
    } else if (card.kind === 'role') {
      if (!isActive || game.phase === 'combat') { actor.hand.push(card); throw new Error('Roles can be chosen on your turn outside combat.'); }
      if (actor.role) actor.hand.push({ name:`Role: ${actor.role}`, kind:'role', role:actor.role, art:'🎭', text:'Previous role.' });
      actor.role = card.role; discardCard(game, card); log(game, `${actor.name} becomes a ${card.role}.`);
    } else if (card.kind === 'origin') {
      if (!isActive || game.phase === 'combat') { actor.hand.push(card); throw new Error('Origins can be chosen on your turn outside combat.'); }
      actor.origin = card.origin; discardCard(game, card); log(game, `${actor.name} reveals their Origin: ${card.origin}.`);
    } else if (card.kind === 'threat') {
      if (!isActive || game.phase !== 'afterChamber') { actor.hand.push(card); throw new Error('You can only challenge a Threat after opening a safe chamber.'); }
      game.combat = { attackerId: actor.id, threat: card, helperId:null, mods:[], escapeUsed:false }; game.phase='combat';
      log(game, `${actor.name} goes looking for trouble: ${card.name}.`);
    } else if (card.kind === 'boost') {
      if (game.phase !== 'combat') { actor.hand.push(card); throw new Error('Boosts are for combat.'); }
      let amount = card.amount;
      if (card.side === 'threat' && actor.origin === 'Nightkin') amount += 1;
      if (card.side === 'threat' && actor.role === 'Hexer') amount += 2;
      if (card.side === 'hero' && actor.role === 'Hexer') amount += 1;
      game.combat.mods.push({ id:nanoid(5), by:actor.name, side:card.side, amount, name:card.name }); discardCard(game, card);
      log(game, `${actor.name} plays ${card.name}: ${card.side === 'threat' ? 'Sabotage' : 'Boost'} +${amount}.`);
    } else if (card.kind === 'instant') {
      if (!isActive && card.effect?.type !== 'autoEscape') { actor.hand.push(card); throw new Error('This can only be played on your turn.'); }
      const e = card.effect || {};
      if (e.type === 'drawLootDiscard') { for(let i=0;i<e.draw;i++){ const c=draw(game.lootDeck, game.lootDiscard); if(c) actor.hand.push(c); } for(let i=0;i<e.discard;i++) discardCard(game, randomTake(actor.hand)); }
      if (e.type === 'gainRenownNonWinning') actor.renown = Math.min(9, actor.renown + e.amount);
      if (e.type === 'stealRandom') { const rival=game.players.find(p=>p.id===action.targetId && p.id!==actor.id); if(rival){ const c=randomTake(rival.hand); if(c) actor.hand.push(c); } }
      if (e.type === 'autoEscape') { if(game.phase !== 'combat') { actor.hand.push(card); throw new Error('No combat to escape.'); } log(game, `${actor.name} uses ${card.name} to bail out.`); discardCard(game, card); nextTurn(game); return; }
      discardCard(game, card); log(game, `${actor.name} uses ${card.name}.`);
    } else if (card.kind === 'hex') {
      const target = playerById(game, action.targetId) || activePlayer(game);
      applyHex(game, target, card); discardCard(game, card); log(game, `${actor.name} drops ${card.name} on ${target.name}.`);
    } else { actor.hand.push(card); throw new Error('This card is not playable right now.'); }
  }

  if (action.type === 'callBackup') {
    if (!isActive || game.phase !== 'combat') throw new Error('Only the fighter can call backup.');
    const helper = playerById(game, action.helperId); if (!helper || helper.id === actor.id) throw new Error('Pick another player.');
    game.combat.pendingHelperId = helper.id;
    log(game, `${actor.name} calls ${helper.name} for backup. Will friendship survive?`);
  }

  if (action.type === 'acceptBackup') {
    if (game.phase !== 'combat' || game.combat.pendingHelperId !== actor.id) throw new Error('No backup request for you.');
    game.combat.helperId = actor.id; game.combat.pendingHelperId = null;
    log(game, `${actor.name} joins the fight for a cut of the Loot.`);
  }

  if (action.type === 'declineBackup') {
    if (game.phase !== 'combat' || game.combat.pendingHelperId !== actor.id) throw new Error('No backup request for you.');
    game.combat.pendingHelperId = null; log(game, `${actor.name} declines backup. Cold-blooded.`);
  }

  if (action.type === 'resolveCombat') {
    if (!isActive || game.phase !== 'combat') throw new Error('Only the fighter can resolve combat.');
    const totals = combatTotals(game);
    if (totals.winning) {
      const previous = actor.renown;
      actor.renown += game.combat.threat.renown || 1;
      const lootCount = game.combat.threat.loot || 1;
      const helper = game.combat.helperId ? playerById(game, game.combat.helperId) : null;
      for (let i=0;i<lootCount;i++) {
        const c = draw(game.lootDeck, game.lootDiscard); if (!c) continue;
        if (helper && i === 0) helper.hand.push(c); else actor.hand.push(c);
      }
      discardCard(game, game.combat.threat);
      game.combat.mods.forEach(m=>{});
      log(game, `${actor.name} wins the fight ${totals.hero} to ${totals.threat}, gains Renown, and grabs Loot.`);
      if (previous < 10 && actor.renown >= 10) { game.status='finished'; game.phase='finished'; game.winnerId=actor.id; log(game, `${actor.name} wins Dungeon Buddies by earning the final Renown in combat!`); return; }
      nextTurn(game);
    } else {
      throw new Error(`You are losing ${totals.hero} to ${totals.threat}. Escape or get help.`);
    }
  }

  if (action.type === 'escape') {
    if (!isActive || game.phase !== 'combat') throw new Error('Only the fighter can escape.');
    const totals = combatTotals(game); if (totals.winning) throw new Error('You are winning. Resolve the fight instead.');
    const roll = Math.ceil(Math.random()*6);
    let target = 4 + (actor.effects.escapePenalty || 0);
    if (actor.role === 'Sneak') target -= 1; if (actor.origin === 'Skyfolk') target -= 1;
    const escaped = roll >= target;
    log(game, `${actor.name} rolls ${roll} to escape. Needed ${target}+. ${escaped ? 'Clean getaway.' : 'Consequences time.'}`);
    if (!escaped) applyConsequence(game, actor);
    discardCard(game, game.combat.threat);
    nextTurn(game);
  }

  return game;
}

export function publicState(room, viewerId) {
  const game = room.game;
  return {
    code: room.code, status: game.status, phase: game.phase, turn: game.turn,
    activePlayerId: game.activePlayerId, winnerId: game.winnerId,
    players: game.players.map(p => ({
      id:p.id, name:p.name, connected:p.connected, renown:p.renown, role:p.role, origin:p.origin,
      handCount:p.hand.length, hand:p.id===viewerId ? p.hand : undefined, gear:p.gear, effects:p.id===viewerId ? p.effects : undefined
    })),
    decks: { chamber: game.chamberDeck.length, loot: game.lootDeck.length, chamberDiscard: game.chamberDiscard.length, lootDiscard: game.lootDiscard.length },
    combat: game.combat ? { ...game.combat, totals: combatTotals(game) } : null,
    log: game.log, chat: game.chat.slice(0,60)
  };
}

export function addChat(room, playerId, text) {
  const p = playerById(room.game, playerId); if (!p) return;
  room.game.chat.unshift({ id:nanoid(6), by:p.name, text:String(text).slice(0,240), at:Date.now() });
  room.game.chat = room.game.chat.slice(0,60);
}
