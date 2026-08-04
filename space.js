const canvas = document.getElementById("space");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

const HARVARD_COLORS = [
  "rgba(215, 228, 255, ",
  "rgba(225, 235, 255, ",
  "rgba(250, 250, 255, ",
  "rgba(255, 253, 245, ",
  "rgba(255, 249, 230, ",
  "rgba(255, 238, 215, ",
  "rgba(255, 215, 215, "
];

let stars = [];
const numStars = 160;

for (let i = 0; i < numStars; i += 1) {
  const randomColorBase = HARVARD_COLORS[Math.floor(Math.random() * HARVARD_COLORS.length)];

  stars.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    depth: Math.random() * 2 + 1,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.2,
    colorBase: randomColorBase
  });
}

let mouseX = -1000;
let mouseY = -1000;
let targetX = canvas.width / 2;
let targetY = canvas.height / 2;

function draw() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  targetX += (mouseX - targetX) * 0.1;
  targetY += (mouseY - targetY) * 0.1;

  for (const s of stars) {
    s.x += s.vx * s.depth;
    s.y += s.vy * s.depth;

    if (s.x < 0) s.x = canvas.width;
    if (s.x > canvas.width) s.x = 0;
    if (s.y < 0) s.y = canvas.height;
    if (s.y > canvas.height) s.y = 0;

    let x = s.x;
    let y = s.y;

    const dx = x - targetX;
    const dy = y - targetY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const blackHoleRadius = 350;

    if (dist < blackHoleRadius) {
      const force = Math.max(0, 1 - dist / blackHoleRadius) * 7000 / (dist * dist + 0.001);
      x -= dx * force;
      y -= dy * force;
    }

    const size = s.depth * 0.8;
    const alpha = 0.3 + (s.depth / 3) * 0.7;

    ctx.fillStyle = s.colorBase + alpha + ")";
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(draw);
}

document.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});

document.addEventListener("mouseleave", () => {
  mouseX = -1000;
  mouseY = -1000;
});

draw();
