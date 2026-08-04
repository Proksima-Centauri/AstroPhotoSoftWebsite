const canvas = document.getElementById("space");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  for (const star of stars) {
    if (star.x < 0 || star.x > canvas.width) {
      star.x = Math.random() * canvas.width;
    }
    if (star.y < 0 || star.y > canvas.height) {
      star.y = Math.random() * canvas.height;
    }
  }

  if (Number.isFinite(pointerX) && Number.isFinite(pointerY)) {
    pointerX = Math.min(Math.max(pointerX, 0), canvas.width);
    pointerY = Math.min(Math.max(pointerY, 0), canvas.height);
  }

  if (Number.isFinite(targetX) && Number.isFinite(targetY)) {
    targetX = Math.min(Math.max(targetX, 0), canvas.width);
    targetY = Math.min(Math.max(targetY, 0), canvas.height);
  }
}

window.addEventListener("resize", resizeCanvas);

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

let pointerActive = false;
let pointerX = canvas.width / 2;
let pointerY = canvas.height / 2;
let targetX = canvas.width / 2;
let targetY = canvas.height / 2;

resizeCanvas();

function draw() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const desiredX = pointerActive ? pointerX : canvas.width / 2;
  const desiredY = pointerActive ? pointerY : canvas.height / 2;
  targetX += (desiredX - targetX) * 0.1;
  targetY += (desiredY - targetY) * 0.1;
  const blackHoleRadius = 350;

  for (const s of stars) {
    s.x += s.vx * s.depth;
    s.y += s.vy * s.depth;

    if (s.x < 0) s.x = canvas.width;
    if (s.x > canvas.width) s.x = 0;
    if (s.y < 0) s.y = canvas.height;
    if (s.y > canvas.height) s.y = 0;

    let x = s.x;
    let y = s.y;

    if (pointerActive) {
      const dx = x - targetX;
      const dy = y - targetY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < blackHoleRadius) {
        const force = Math.max(0, 1 - dist / blackHoleRadius) * 7000 / (dist * dist + 0.001);
        x -= dx * force;
        y -= dy * force;
      }
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
  pointerActive = true;
  pointerX = e.clientX;
  pointerY = e.clientY;
});

document.addEventListener("mouseleave", () => {
  pointerActive = false;
});

document.addEventListener("touchmove", (e) => {
  if (!e.touches || e.touches.length === 0) {
    return;
  }

  pointerActive = true;
  pointerX = e.touches[0].clientX;
  pointerY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener("touchend", () => {
  pointerActive = false;
});

document.addEventListener("touchcancel", () => {
  pointerActive = false;
});

draw();
