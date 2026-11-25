/** Throwaway #334: three Chat layouts on #/chat, selected by ?variant=A|B|C.
 * Uses the real message/card renderer; all interactions are memory-only stubs.
 * This entry is bundled only by `npm run prototype:android-chat`.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { getTheme, ModePill, MessageThread } from './ChatAppView.js';
import { ObscurityTargetPicker } from './ObscurityTargetPicker.js';
import { FeedbackReactionBar } from './FeedbackReactionBar.js';
import { t, onLanguageChange } from '../i18n/i18n.js';
import type { CardViewProps, MessageViewProps } from '../chatRenderAdapter.js';
import type { ChatHandlers } from './viewTypes.js';
import type { ObscurityTarget } from '../../../../shared/schemas/src/contracts.js';

const h = React.createElement;
type Variant = 'A' | 'B' | 'C';
type Chat = { id: string; title: string; date: string; messages: MessageViewProps[] };
const variants: Variant[] = ['A', 'B', 'C'];
const route = () => location.hash.slice(2).split('?')[0] || 'chat';
const variantFromUrl = (): Variant => {
  const value = new URLSearchParams(location.search || location.hash.split('?')[1]).get('variant');
  return value === 'B' || value === 'C' ? value : 'A';
};
function card(name: string, why: string, connection: string): CardViewProps {
  return { target: { name, suggestedNote: why }, title: name, why, country: 'UK', genres: ['Atmospheric black metal'], signals: [], connection, imageUrl: null, saved: false, rating: null, savedBandId: null, categories: [], note: why, noteEdited: false,
    actions: { save: { visible: true }, rate: { visible: true }, more: { visible: true } },
    platformLinks: [{ platform: 'bandcamp', label: 'Bandcamp', url: 'https://bandcamp.com' }] };
}
function sample(): Chat[] {
  return [{ id: 'one', title: t('prototype334.sampleName'), date: '2026-11-25', messages: [
    { id: 'q1', role: 'user', content: t('prototype334.question') },
    { id: 'a1', role: 'assistant', content: '', cards: [card('Les Discrets', t('prototype334.earlierWhy'), '')] },
    { id: 'q2', role: 'user', content: t('prototype334.followUp') },
    { id: 'a2', role: 'assistant', content: t('prototype334.sampleReply'), cards: [card('Fen', t('prototype334.fenWhy'), t('prototype334.fenConnection')), card('Wodensthrone', t('prototype334.wodenWhy'), t('prototype334.wodenConnection'))] },
  ] }, { id: 'two', title: t('prototype334.otherName'), date: '2026-11-24', messages: [] }];
}
function button(label: string, onClick: () => void, props: React.ButtonHTMLAttributes<HTMLButtonElement> & React.Attributes = {}) {
  return h('button', { type: 'button', onClick, ...props }, label);
}
function App() {
  const [variant, setVariant] = React.useState(variantFromUrl);
  const [chats, setChats] = React.useState(sample);
  const [active, setActive] = React.useState<string | null>('one');
  const [screen, setScreen] = React.useState(route());
  const [mode, setMode] = React.useState('fresh');
  const [target, setTarget] = React.useState<ObscurityTarget | undefined>('underground');
  const [restored, setRestored] = React.useState(false);
  const [feedback, setFeedback] = React.useState(false);
  const [inspect, setInspect] = React.useState(false);
  const [simulated, setSimulated] = React.useState(false);
  const [viewport, setViewport] = React.useState({ height: visualViewport?.height ?? innerHeight, width: innerWidth, top: 0, keyboard: false });
  const [status, setStatus] = React.useState('');
  const [deleted, setDeleted] = React.useState<Chat | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [, languageChanged] = React.useReducer((n: number) => n + 1, 0);
  const current = chats.find(c => c.id === active);
  const theme = getTheme(mode);
  const keyboard = simulated || viewport.keyboard;
  function navigate(next: string) { location.hash = '/' + next + (location.protocol === 'about:' ? '?variant=' + variant : ''); }
  function cycle(delta: number) {
    const next = variants[(variants.indexOf(variant) + delta + 3) % 3]!;
    const url = new URL(location.href); url.searchParams.set('variant', next);
    history.replaceState(null, '', location.protocol === 'about:' ? `#/${screen}?variant=${next}` : url); setVariant(next);
  }
  React.useEffect(() => onLanguageChange(() => languageChanged()), []);
  React.useEffect(() => {
    const change = () => setScreen(route());
    addEventListener('hashchange', change); return () => removeEventListener('hashchange', change);
  }, []);
  React.useEffect(() => {
    const measure = () => setViewport({ height: visualViewport?.height ?? innerHeight, width: innerWidth, top: visualViewport?.offsetTop ?? 0, keyboard: innerHeight - (visualViewport?.height ?? innerHeight) > 120 });
    measure(); visualViewport?.addEventListener('resize', measure); visualViewport?.addEventListener('scroll', measure); addEventListener('resize', measure);
    return () => { visualViewport?.removeEventListener('resize', measure); visualViewport?.removeEventListener('scroll', measure); removeEventListener('resize', measure); };
  }, []);
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); cycle(e.key === 'ArrowLeft' ? -1 : 1); }
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  });
  React.useEffect(() => { if (!status || deleted) return; const id = setTimeout(() => setStatus(''), 3000); return () => clearTimeout(id); }, [status, deleted]);
  React.useEffect(() => { if (!deleted) return; const id = setTimeout(() => { setDeleted(null); setStatus(''); }, 6000); return () => clearTimeout(id); }, [deleted]);
  function updateCard(name: string, update: Partial<CardViewProps>) {
    setChats(old => old.map(c => ({ ...c, messages: c.messages.map(m => m.role === 'assistant' ? { ...m, cards: m.cards.map(item => item.title === name ? { ...item, ...update } : item) } : m) })));
    setStatus(t('prototype334.changed'));
  }
  const handlers: ChatHandlers = {
    onModeChange: setMode, onQuerySubmit: () => {},
    onSave: target => updateCard(target.name, { saved: true, savedBandId: target.name }),
    onUnsave: (_id, name) => updateCard(name, { saved: false, rating: null, savedBandId: null }),
    onRate: (target, rating) => updateCard(target.name, { saved: true, savedBandId: target.name, rating }),
    onSaveCategoryNote: (target, updates) => updateCard(target.name, { ...updates, saved: true, savedBandId: target.name }),
    onCopyCard: (name, why) => { void navigator.clipboard?.writeText(`${name} — ${why}`); setStatus(t('prototype334.copied')); },
    onCopyAll: text => { void navigator.clipboard?.writeText(text); setStatus(t('prototype334.copied')); },
    onOpenLink: url => setStatus(t('prototype334.link', { url })),
  };
  function newChat() { setActive(null); setRestored(false); navigate('chat'); }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const input = e.currentTarget.elements.namedItem('query') as HTMLInputElement;
    const query = input.value.trim(); if (!query) return; input.value = ''; input.blur(); setRestored(false);
    const id = active ?? String(Date.now());
    const messages: MessageViewProps[] = [{ id: `${Date.now()}q`, role: 'user', content: query }, { id: `${Date.now()}a`, role: 'assistant', content: t('prototype334.sampleReply'), cards: [card('Fen', t('prototype334.fenWhy'), t('prototype334.fenConnection'))] }];
    setChats(old => active ? old.map(c => c.id === active ? { ...c, messages: [...c.messages, ...messages] } : c) : [{ id, title: query.length > 60 ? query.slice(0, 59).replace(/\s+\S*$/, '') + '…' : query, date: '2026-11-25', messages }, ...old]);
    setActive(id); setFeedback(true);
  }
  const disclosure = h('p', { className: 'prototype-disclosure' }, t('prototype334.disclosure'));
  const feedbackBar = h(FeedbackReactionBar, { visible: feedback, onFeedback: () => setFeedback(false), onDismiss: () => setFeedback(false) });
  const modes = h(ModePill, { modeValue: mode, modeOptions: [{ value: 'fresh', label: t('prototype334.fresh') }, { value: 'preference-aware', label: t('prototype334.warm') }], onModeChange: setMode });
  const header = h('header', { className: 'prototype-header' }, h('div', { className: 'prototype-title-row' }, h('h1', null, t('prototype334.title')), h('div', null, button(t('prototype334.chats'), () => navigate('chats')), button(t('prototype334.newChat'), newChat))), modes,
    restored && current ? h('div', { className: 'prototype-restored' }, button(t('prototype334.continue'), () => setRestored(false)), button(t('prototype334.newChat'), newChat)) : null);
  const composer = h('div', { className: 'prototype-composer' }, variant !== 'B' ? feedbackBar : null,
    h(ObscurityTargetPicker, { target, onTargetChange: setTarget }),
    h('form', { onSubmit: submit }, h('input', { name: 'query', placeholder: t('prototype334.query'), autoComplete: 'off', className: 'query-input', 'aria-label': t('prototype334.query') }), h('button', { type: 'submit', className: 'recommend-btn' }, t('prototype334.recommend'))), variant !== 'B' ? disclosure : null);
  const thread = h('div', { className: 'prototype-transcript' }, variant === 'B' ? disclosure : null,
    current?.messages.length ? h(MessageThread, { messages: current.messages, theme, isMobile: true, handlers, prototypeCollapseEarlier: variant !== 'C' }) : h('p', { className: 'prototype-empty' }, t('prototype334.empty')),
    variant === 'B' ? feedbackBar : null);
  const list = h('section', { className: 'prototype-list' }, h('header', { className: 'prototype-title-row' }, button('←', () => navigate('chat'), { 'aria-label': t('common.back') }), h('h1', null, t('prototype334.chats'))),
    chats.map(c => h('article', { key: c.id }, editing === c.id ? h('form', { onSubmit: (e: React.FormEvent) => { e.preventDefault(); if (!title.trim()) return; setChats(old => old.map(row => row.id === c.id ? { ...row, title: title.trim() } : row)); setEditing(null); } }, h('input', { value: title, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value), 'aria-label': t('prototype334.titleLabel'), autoFocus: true }), h('button', { type: 'submit' }, t('prototype334.save')), button(t('common.cancel'), () => setEditing(null))) : h(React.Fragment, null,
      button(c.title, () => { setActive(c.id); setRestored(false); navigate('chat'); }, { className: 'prototype-chat-title' }), h('time', null, c.date),
      h('div', { className: 'prototype-list-actions' }, button(t('prototype334.rename'), () => { setEditing(c.id); setTitle(c.title); }), button(t('prototype334.delete'), () => { setDeleted(c); setChats(old => old.filter(row => row.id !== c.id)); if (active === c.id) setActive(null); setStatus(t('prototype334.removed')); }))))));
  const height = simulated ? Math.min(viewport.height, 457) : viewport.height;
  return h('div', { className: `prototype-app variant-${variant}${keyboard ? ' keyboard-open' : ''}`, style: { '--prototype-height': `${height}px`, '--prototype-top': `${viewport.top}px`, '--prototype-accent': theme.accent, '--prototype-dim': theme.accentDim } as React.CSSProperties, 'data-variant': variant },
    h('div', { className: 'prototype-content' }, screen === 'chat' ? h(React.Fragment, null, header, thread, composer) : screen === 'chats' ? list : h('section', { className: 'prototype-list' }, button('←', () => navigate('chat'), { 'aria-label': t('common.back') }), h('p', null, t('prototype334.demoOnly')))),
    status ? h('div', { className: 'prototype-status', role: 'status' }, status, deleted ? button(t('prototype334.undo'), () => { setChats(old => [...old, deleted].sort((a, b) => b.date.localeCompare(a.date))); setDeleted(null); setStatus(''); }) : null) : null,
    !keyboard ? h('nav', { className: 'prototype-tabs' }, ...(['chat', 'saved', 'settings'] as const).map(tab => button(t(`prototype334.${tab}`), () => navigate(tab), { 'aria-current': screen === tab || (tab === 'chat' && screen === 'chats') ? 'page' : undefined, key: tab }))) : null,
    h('aside', { className: 'prototype-switcher', 'aria-label': t('prototype334.badge') }, button('←', () => cycle(-1), { 'aria-label': t('prototype334.previous') }), button(t(`prototype334.${variant}`), () => setInspect(!inspect), { 'aria-label': t('prototype334.inspect'), 'aria-expanded': inspect }), button('→', () => cycle(1), { 'aria-label': t('prototype334.next') })),
    inspect ? h('aside', { className: 'prototype-inspector' }, h('strong', null, t('prototype334.badge')), h('p', null, t('prototype334.info')), h('p', null, t('prototype334.state', { width: viewport.width, height: Math.round(height), keyboard: t(keyboard ? 'prototype334.on' : 'prototype334.off'), count: chats.length })), button(t('prototype334.reset'), () => { setChats(sample()); setActive('one'); setRestored(false); setFeedback(false); navigate('chat'); }), button(t('prototype334.restored'), () => { setRestored(!restored); navigate('chat'); }), button(t('prototype334.feedback'), () => setFeedback(!feedback)), button(t('prototype334.keyboard'), () => setSimulated(!simulated))) : null);
}
if (!location.hash) history.replaceState(null, '', '#/chat');
createRoot(document.getElementById('root')!).render(h(App));
