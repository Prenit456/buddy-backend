// Matches the 320x240 geometry, palette and idle blink used by firmware/buddy_cloud.
const canvas = document.querySelector('#buddyTftPreview');
const context = canvas.getContext('2d');
let gazeX = 0, gazeY = 0, nextGlance = 0, nextBlink = 0, blinkAt = 0;
const hex565 = value => {
  const n = Number(value) || 20127;
  const red = Math.round(((n >> 11) & 31) * 255 / 31);
  const green = Math.round(((n >> 5) & 63) * 255 / 63);
  const blue = Math.round((n & 31) * 255 / 31);
  return `rgb(${red},${green},${blue})`;
};
function roundRect(x, y, width, height, radius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(x, y, width, height, Math.min(radius, height / 2));
  context.fill();
}
function ellipse(x, y, rx, ry, color) {
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  context.fill();
}
function draw(now) {
  if (now >= nextGlance) {
    gazeX = Math.floor(Math.random() * 27) - 13;
    gazeY = Math.floor(Math.random() * 17) - 8;
    nextGlance = now + 1200 + Math.random() * 2300;
  }
  if (!blinkAt && now >= nextBlink) blinkAt = now;
  let height = 142;
  if (blinkAt) {
    const phase = now - blinkAt;
    if (phase < 95) height = Math.max(5, 142 - phase * 137 / 95);
    else if (phase < 190) height = Math.min(142, 5 + (phase - 95) * 137 / 95);
    else { blinkAt = 0; nextBlink = now + 2600 + Math.random() * 3400; }
  }
  context.fillStyle = hex565(0x0842);
  context.fillRect(0, 0, 320, 240);
  context.fillStyle = hex565(0x10a4);
  context.fillRect(0, 0, 320, 29);
  const current = new Date();
  context.fillStyle = 'white';
  context.font = '16px sans-serif';
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillText(current.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 8, 5);
  context.textAlign = 'center';
  context.fillText(current.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }), 160, 5);
  context.textAlign = 'right';
  context.fillText('--%', 312, 5);
  const eyeColor = hex565(document.querySelector('#deviceSettingsForm [name=eyeColor]')?.value);
  const top = 55 + (142 - height) / 2;
  for (const x of [33, 169]) {
    roundRect(x - 3, top - 3, 124, height + 6, 36, hex565(0x10a4));
    roundRect(x, top, 118, height, 34, eyeColor);
    if (height > 50) {
      const pupilX = x + 59 + gazeX, pupilY = 126 + gazeY;
      ellipse(pupilX, pupilY, 30, 43, hex565(0x0842));
      ellipse(pupilX - 9, pupilY - 14, 10, 10, 'white');
      ellipse(pupilX + 10, pupilY + 16, 4, 4, hex565(0xd6ba));
    }
  }
  setTimeout(() => requestAnimationFrame(draw), 55);
}
requestAnimationFrame(draw);
