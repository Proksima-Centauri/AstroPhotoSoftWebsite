const canvas = document.getElementById("space");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let stars = [];
let meteors = [];

/* ⭐ GWIAZDY */
for (let i = 0; i < 200; i++) {
  stars.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.5,
    speed: Math.random() * 0.3
  });
}

/* 🌠 METEORY */
function spawnMeteor() {
  meteors.push({
    x: Math.random() * canvas.width,
    y: -50,
    vx: Math.random() * 4 - 2,
    vy: Math.random() * 6 + 4,
    len: Math.random() * 80 + 40
  });
}

setInterval(spawnMeteor, 2000);

/* ANIMATION */
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  /* stars */
  ctx.fillStyle = "white";
  for (let s of stars) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();

    s.y += s.speed;
    if (s.y > canvas.height) s.y = 0;
  }

  /* meteors */
  for (let m of meteors) {
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * m.len, m.y - m.vy * m.len);
    ctx.stroke();

    m.x += m.vx;
    m.y += m.vy;
  }

  meteors = meteors.filter(m => m.y < canvas.height + 100);

  requestAnimationFrame(draw);
}

draw();

/* 🌌 PARALLAX SCROLL */
document.addEventListener("scroll", () => {
  let scrollY = window.scrollY;

  document.querySelectorAll(".layer").forEach(el => {
    let depth = el.getAttribute("data-depth");
    el.style.transform = `translateY(${scrollY * depth}px)`;
  });
});

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});