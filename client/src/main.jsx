import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const socket = io();

function callback(setError) {
  return (res) => { if (!res?.ok) setError(res?.error || 'Something went sideways.'); };
}
function Card({ card, onPlay, disabled, combat }) {
  if (!card) return null;
  const playable = !disabled;
  return <button className={`card ${card.kind || ''}`} disabled={!playable} onClick={() => onPlay?.(card)}>
    <div className="art">{card.art || '🃏'}</div>
    <div className="cardTitle">{card.name}</div>
    <div className="tag">{card.kind}{card.slot ? ` • ${card.slot}` : ''}{card.bonus ? ` • +${card.bonus}` : ''}{card.strength ? ` • ${card.strength}` : ''}</div>
    <p>{card.text}</p>
    {combat && card.kind === 'boost' && <strong>{card.side === 'threat' ? 'Sabotage' : 'Boost'} +{card.amount}</strong>}
  </button>
}
function PlayerPlate({ p, active, self }) {
  const gear = Object.entries(p.gear || {}).filter(([_,c]) => c && !c.paired);
  return <section className={`player ${active ? 'active' : ''} ${self ? 'self' : ''}`}>
    <div className="plateTop"><strong>{p.name}{self ? ' (You)' : ''}</strong><span>{p.connected ? '🟢' : '⚫'}</span></div>
    <div className="renown">Renown {p.renown}</div>
    <div className="mini">{p.role || 'No Role'} • {p.origin || 'No Origin'} • {p.handCount} cards</div>
    <div className="gearRow">{gear.length ? gear.map(([slot,c]) => <span key={slot} title={c.text}>{c.art} {slot}</span>) : <em>No gear</em>}</div>
  </section>
}
function Lobby({ setState, setError }) {
  const [name,setName]=useState(localStorage.dbName || '');
  const [code,setCode]=useState('');
  function saveName(){ localStorage.dbName=name; }
  return <main className="lobby shell">
    <div className="hero"><span className="logo">🧌</span><h1>Dungeon Buddies</h1><p>An original remote chaos-card game for three friends. Open chambers, call backup, sabotage people you allegedly care about.</p></div>
    <label>Your name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Trey / Scott / Justin" /></label>
    <div className="lobbyButtons">
      <button onClick={()=>{saveName(); socket.emit('createRoom',{name},(res)=>{ if(res.ok) setState(s=>({...s, code:res.code})); else setError(res.error); });}}>Create Room</button>
      <label>Room code<input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="ABC123" /></label>
      <button className="secondary" onClick={()=>{saveName(); socket.emit('joinRoom',{code,name},(res)=>{ if(res.ok) setState(s=>({...s, code:res.code})); else setError(res.error); });}}>Join Room</button>
    </div>
    <div className="note"><b>V1 rules locked:</b> no hand limit, sabotage any time during combat, final win must come from combat.</div>
  </main>
}

function Game({ state, setError }) {
  const me = state.players?.find(p => p.hand);
  const active = state.players?.find(p => p.id === state.activePlayerId);
  const myTurn = me?.id === state.activePlayerId;
  const inCombat = state.phase === 'combat';
  const canStart = state.status === 'lobby' && state.players?.length === 3;
  const send = (action) => socket.emit('action', { code:state.code, action }, callback(setError));
  const [chat,setChat]=useState('');
  const [target,setTarget]=useState('');
  const others = state.players?.filter(p=>p.id!==me?.id) || [];
  function play(card) {
    let payload = { type:'playCard', cardId:card.id };
    if (card.kind === 'hex' || card.effect?.type === 'stealRandom') payload.targetId = target || others[0]?.id;
    send(payload);
  }
  const playableHint = (card) => {
    if (!card) return true;
    if (card.kind === 'boost') return inCombat;
    if (card.kind === 'hex') return true;
    if (card.kind === 'threat') return myTurn && state.phase === 'afterChamber';
    if (card.kind === 'gear' || card.kind === 'role' || card.kind === 'origin' || card.kind === 'instant') return myTurn && !inCombat;
    return myTurn;
  };
  return <main className="game shell">
    <header className="topbar"><div><h1>Dungeon Buddies</h1><span>Room <b>{state.code}</b> • Turn {state.turn || 0} • {state.phase}</span></div><button onClick={()=>navigator.clipboard?.writeText(state.code)}>Copy Code</button></header>
    {state.status === 'lobby' && <section className="panel"><h2>Lobby</h2><p>Need exactly 3 players. Current: {state.players.length}/3.</p>{canStart && <button onClick={()=>socket.emit('startGame',{code:state.code},callback(setError))}>Start the Run</button>}</section>}
    {state.status === 'finished' && <section className="winner"><h2>🏆 {state.players.find(p=>p.id===state.winnerId)?.name} wins!</h2><p>The final Renown came from combat, as the dungeon gods demanded.</p></section>}
    <section className="players">{state.players.map(p=><PlayerPlate key={p.id} p={p} active={p.id===state.activePlayerId} self={p.id===me?.id}/>)}</section>
    <section className="board">
      <div className="combatZone">
        <h2>{inCombat ? 'Threat Encounter' : 'Table'}</h2>
        {inCombat ? <>
          <div className="threat"><div className="bigArt">{state.combat.threat.art}</div><h3>{state.combat.threat.name}</h3><p>{state.combat.threat.text}</p><b>Threat {state.combat.threat.strength}</b><small>{state.combat.threat.consequence}</small></div>
          <div className="score"><span>Heroes: <b>{state.combat.totals.hero}</b></span><span>Threat: <b>{state.combat.totals.threat}</b></span><span>{state.combat.totals.winning ? 'Winning ✅' : 'Losing 😬'}</span></div>
          <div className="mods">{state.combat.mods.map(m=><span key={m.id}>{m.side === 'threat' ? '😈' : '✅'} {m.name} +{m.amount} by {m.by}</span>)}</div>
          {state.combat.pendingHelperId && <p className="pulse">Backup request pending for {state.players.find(p=>p.id===state.combat.pendingHelperId)?.name}</p>}
          {myTurn && <div className="actions"><button onClick={()=>send({type:'resolveCombat'})}>Resolve Fight</button><button className="danger" onClick={()=>send({type:'escape'})}>Try to Escape</button></div>}
          {myTurn && !state.combat.helperId && <div className="actions small">{others.map(o=><button key={o.id} onClick={()=>send({type:'callBackup', helperId:o.id})}>Call {o.name} for Backup</button>)}</div>}
          {state.combat.pendingHelperId === me?.id && <div className="actions"><button onClick={()=>send({type:'acceptBackup'})}>Accept Backup</button><button className="secondary" onClick={()=>send({type:'declineBackup'})}>Decline</button></div>}
        </> : <>
          <div className="decks"><span>🚪 Chambers: {state.decks.chamber}</span><span>💰 Loot: {state.decks.loot}</span><span>Discard: {state.decks.chamberDiscard}/{state.decks.lootDiscard}</span></div>
          <p>{active?.name || 'Someone'} is up.</p>
        </>}
        {myTurn && state.phase === 'awaitingChamber' && <button className="primary" onClick={()=>send({type:'openChamber'})}>Open a Chamber</button>}
        {myTurn && state.phase === 'afterChamber' && <div className="actions"><button onClick={()=>send({type:'scavenge'})}>Scavenge Loot & End Turn</button><button className="secondary" onClick={()=>send({type:'endTurn'})}>End Turn</button></div>}
      </div>
      <aside className="log"><h3>Group Chat</h3><form onSubmit={e=>{e.preventDefault(); if(chat.trim()) socket.emit('chat',{code:state.code,text:chat},callback(setError)); setChat('');}}><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="talk trash..."/><button>Send</button></form>{state.chat.map(c=><p key={c.id}><b>{c.by}:</b> {c.text}</p>)}<h3>Action Log</h3>{state.log.map(l=><p key={l.id}>{l.message}</p>)}</aside>
    </section>
    <section className="hand"><div className="handTop"><h2>Your Hand</h2><select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Default target</option>{others.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></div><div className="cards">{me?.hand?.map(card=><Card key={card.id} card={card} onPlay={play} disabled={!playableHint(card)} combat={inCombat}/>)}</div></section>
  </main>
}

function App(){
  const [state,setState]=useState({});
  const [error,setError]=useState('');
  useMemo(()=>{ socket.on('state', setState); return()=>socket.off('state', setState); },[]);
  return <>{error && <div className="toast" onClick={()=>setError('')}>{error}</div>}{state?.players ? <Game state={state} setError={setError}/> : <Lobby setState={setState} setError={setError}/>}</>;
}

createRoot(document.getElementById('root')).render(<App/>);
