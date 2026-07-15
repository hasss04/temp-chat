const ADJ = ['quiet', 'coral', 'dusk', 'amber', 'northern', 'silent', 'violet', 'cedar', 'harbor', 'ember'];
const NOUN = ['orbit', 'harbor', 'lantern', 'ridge', 'signal', 'ember', 'thicket', 'current', 'foxglove', 'meridian'];

export function generateRoomId(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${a}-${n}-${num}`;
}