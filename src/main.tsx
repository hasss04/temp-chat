import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

function printEasterEgg() {
  const title = `
    color: #1f172a;
    background: linear-gradient(90deg, #f9a8d4, #c4b5fd, #93c5fd);
    font-weight: 900;
    font-size: 16px;
    padding: 8px 12px;
    border-radius: 10px;
  `;

  const soft = 'color:#7c6f89;font-size:12px;line-height:1.6;';
  const pink = 'color:#ec4899;font-weight:bold;';
  const blue = 'color:#60a5fa;font-weight:bold;';
  const bunnyMono = 'color:#c084fc;font-family:monospace;line-height:1.2;';
  const logoMono = 'font-family:monospace;color:#5b9ee4;';

  const bunnyLines = [
    'Tiny bunny has inspected your DevTools and approves.',
    'You have been visited by the debugging bun of destiny.',
    'No carrots stored here. Only encrypted messages.',
    'This rabbit knows CSS and refuses to elaborate.',
    'Sniff sniff... yep, still end-to-end encrypted.',
  ];

  const bunnyMood =
    bunnyLines[Math.floor(Math.random() * bunnyLines.length)];

  console.log('%c🐰 shhh... you found the bunny burrow', title);
  console.log('%c' + bunnyMood, soft);
  console.log(
    '%cBun fact:%c messages here are end-to-end encrypted and disappear later.',
    soft,
    blue
  );
  console.log(
    '%cImportant:%c poking around is allowed, stealing secrets is not possible.',
    soft,
    pink
  );
  console.log(
    '%cRabbit status:%c ears up, nose booping, security excellent.',
    soft,
    blue
  );
  console.log(
    '%cOfficial warning:%c this app may contain excessive fluff.',
    soft,
    pink
  );

  console.log(
    '%c%s',
    bunnyMono,
`
(\\_/)
( •_•)
 / >💌   secret message bun

 /)/)
( . .)   sniffing for bugs...
( づ🥕   only found carrots
`
  );

  console.log(
    '%c%s',
    logoMono,
    `
   ______                 ________          __
  /_  __/__ __ _  ___   / ___/ / _ )___ ___/ /___
   / / / -_)  ' \\/ _ \\/ /__/ / _  / _ \`/ _  / -_)
  /_/  \\__/_/_/_/ .__/\\___/_/____/\\_,_/\\_,_/\\__/
               /_/      — self-destructing chats
    `
  );
}

printEasterEgg();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);