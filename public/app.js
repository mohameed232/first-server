(() => {
  "use strict";

  const root = document.documentElement;
  const body = document.body;
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionToggle = document.querySelector("#motion-toggle");
  const motionLabel = motionToggle?.querySelector(".button-label");
  let userPaused = reduceMotionQuery.matches;
  let pageVisible = !document.hidden;

  const state = {
    pointerX: 0,
    pointerY: 0,
    targetX: 0,
    targetY: 0,
    frame: 0,
  };

  function motionIsActive() {
    return !userPaused && pageVisible;
  }

  function updateMotionUi() {
    body.classList.toggle("motion-paused", userPaused);
    motionToggle?.setAttribute("aria-pressed", String(userPaused));
    if (motionLabel) motionLabel.textContent = userPaused ? "تشغيل الحركة" : "إيقاف الحركة";
  }

  motionToggle?.addEventListener("click", () => {
    userPaused = !userPaused;
    updateMotionUi();
    if (!userPaused) requestAnimationFrame(renderFrame);
  });

  reduceMotionQuery.addEventListener("change", (event) => {
    userPaused = event.matches;
    updateMotionUi();
    if (!userPaused) requestAnimationFrame(renderFrame);
  });

  document.addEventListener("visibilitychange", () => {
    pageVisible = !document.hidden;
    if (pageVisible && !userPaused) requestAnimationFrame(renderFrame);
  });

  function setPointer(clientX, clientY) {
    state.targetX = Math.max(-1, Math.min(1, (clientX / window.innerWidth - 0.5) * 2));
    state.targetY = Math.max(-1, Math.min(1, (clientY / window.innerHeight - 0.5) * 2));
  }

  window.addEventListener("pointermove", (event) => setPointer(event.clientX, event.clientY), { passive: true });
  window.addEventListener("pointerleave", () => {
    state.targetX = 0;
    state.targetY = 0;
  });

  const coreInteraction = document.querySelector("#core-interaction");
  coreInteraction?.addEventListener("touchmove", (event) => {
    const touch = event.touches[0];
    if (touch) setPointer(touch.clientX, touch.clientY);
  }, { passive: true });

  // خلفية خفيفة: نقاط ومسارات بيانات مولّدة محليًا.
  const ambientCanvas = document.querySelector("#ambient-canvas");
  const ambientContext = ambientCanvas?.getContext("2d");
  let ambientWidth = 0;
  let ambientHeight = 0;
  let ambientDpr = 1;
  let particles = [];

  function makeParticle(index) {
    const lane = index % 7;
    return {
      x: Math.random(),
      y: Math.random(),
      speed: 0.00008 + Math.random() * 0.00022,
      size: 0.6 + Math.random() * 1.6,
      alpha: 0.12 + Math.random() * 0.4,
      warm: index % 13 === 0,
      lane,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function resizeAmbient() {
    if (!ambientCanvas || !ambientContext) return;
    ambientDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    ambientWidth = window.innerWidth;
    ambientHeight = window.innerHeight;
    ambientCanvas.width = Math.floor(ambientWidth * ambientDpr);
    ambientCanvas.height = Math.floor(ambientHeight * ambientDpr);
    ambientContext.setTransform(ambientDpr, 0, 0, ambientDpr, 0, 0);
    const count = Math.min(86, Math.max(34, Math.floor((ambientWidth * ambientHeight) / 22000)));
    particles = Array.from({ length: count }, (_, index) => makeParticle(index));
  }

  function drawAmbient(time) {
    if (!ambientContext) return;
    ambientContext.clearRect(0, 0, ambientWidth, ambientHeight);

    particles.forEach((particle) => {
      if (motionIsActive()) {
        particle.y -= particle.speed * 16;
        particle.x += Math.sin(time * 0.0002 + particle.phase) * 0.000035;
        if (particle.y < -0.02) {
          particle.y = 1.02;
          particle.x = Math.random();
        }
      }

      const x = particle.x * ambientWidth + state.pointerX * (particle.lane - 3) * 2.2;
      const y = particle.y * ambientHeight;
      const color = particle.warm ? "255, 122, 26" : "66, 217, 255";
      ambientContext.beginPath();
      ambientContext.arc(x, y, particle.size, 0, Math.PI * 2);
      ambientContext.fillStyle = `rgba(${color}, ${particle.alpha})`;
      ambientContext.fill();

      if (particle.lane === 0) {
        ambientContext.beginPath();
        ambientContext.moveTo(x, y + 3);
        ambientContext.lineTo(x, y + 32);
        ambientContext.strokeStyle = `rgba(${color}, ${particle.alpha * 0.2})`;
        ambientContext.stroke();
      }
    });
  }

  // كرة نقطية ثلاثية الأبعاد بلا مكتبات خارجية.
  const coreCanvas = document.querySelector("#core-canvas");
  const coreContext = coreCanvas?.getContext("2d");
  const spherePoints = [];
  const pointCount = 520;

  for (let index = 0; index < pointCount; index += 1) {
    const y = 1 - (index / (pointCount - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = Math.PI * (3 - Math.sqrt(5)) * index;
    spherePoints.push({
      x: Math.cos(theta) * radiusAtY,
      y,
      z: Math.sin(theta) * radiusAtY,
      hot: index % 41 === 0,
      size: 0.65 + (index % 5) * 0.12,
    });
  }

  function rotatePoint(point, angleY, angleX) {
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const x1 = point.x * cosY - point.z * sinY;
    const z1 = point.x * sinY + point.z * cosY;
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    return {
      x: x1,
      y: point.y * cosX - z1 * sinX,
      z: point.y * sinX + z1 * cosX,
    };
  }

  function drawCore(time) {
    if (!coreCanvas || !coreContext) return;
    const width = coreCanvas.width;
    const height = coreCanvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width * 0.245;
    const rotation = time * 0.00013;
    const tiltX = state.pointerY * 0.18 - 0.18;
    const tiltY = rotation + state.pointerX * 0.25;

    coreContext.clearRect(0, 0, width, height);

    const halo = coreContext.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius * 1.7);
    halo.addColorStop(0, "rgba(180, 245, 255, 0.22)");
    halo.addColorStop(0.28, "rgba(35, 157, 255, 0.13)");
    halo.addColorStop(0.65, "rgba(18, 107, 255, 0.04)");
    halo.addColorStop(1, "rgba(18, 107, 255, 0)");
    coreContext.fillStyle = halo;
    coreContext.fillRect(0, 0, width, height);

    const sphere = coreContext.createRadialGradient(
      centerX - radius * 0.34,
      centerY - radius * 0.4,
      radius * 0.04,
      centerX,
      centerY,
      radius * 1.06,
    );
    sphere.addColorStop(0, "rgba(210, 250, 255, 0.92)");
    sphere.addColorStop(0.08, "rgba(72, 219, 255, 0.72)");
    sphere.addColorStop(0.35, "rgba(20, 108, 211, 0.35)");
    sphere.addColorStop(0.72, "rgba(4, 34, 66, 0.78)");
    sphere.addColorStop(1, "rgba(1, 10, 20, 0.97)");
    coreContext.beginPath();
    coreContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
    coreContext.fillStyle = sphere;
    coreContext.fill();

    coreContext.save();
    coreContext.beginPath();
    coreContext.arc(centerX, centerY, radius, 0, Math.PI * 2);
    coreContext.clip();
    const ordered = spherePoints
      .map((point) => ({ point, rotated: rotatePoint(point, tiltY, tiltX) }))
      .sort((a, b) => a.rotated.z - b.rotated.z);

    ordered.forEach(({ point, rotated }) => {
      const depth = (rotated.z + 1) / 2;
      const x = centerX + rotated.x * radius;
      const y = centerY + rotated.y * radius;
      const alpha = 0.12 + depth * 0.72;
      const size = point.size + depth * 1.45;
      coreContext.beginPath();
      coreContext.arc(x, y, size, 0, Math.PI * 2);
      coreContext.fillStyle = point.hot
        ? `rgba(255, 142, 56, ${alpha})`
        : `rgba(119, 228, 255, ${alpha})`;
      coreContext.fill();
    });

    coreContext.strokeStyle = "rgba(111, 225, 255, 0.16)";
    coreContext.lineWidth = 1;
    [-0.62, -0.26, 0.18, 0.58].forEach((latitude) => {
      coreContext.beginPath();
      coreContext.ellipse(centerX, centerY + latitude * radius, radius * Math.sqrt(1 - latitude ** 2), radius * 0.13, 0, 0, Math.PI * 2);
      coreContext.stroke();
    });
    coreContext.restore();

    coreContext.beginPath();
    coreContext.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
    coreContext.strokeStyle = "rgba(130, 236, 255, 0.68)";
    coreContext.lineWidth = 1.2;
    coreContext.shadowBlur = 16;
    coreContext.shadowColor = "#42d9ff";
    coreContext.stroke();
    coreContext.shadowBlur = 0;

    for (let index = 0; index < 18; index += 1) {
      const angle = (index / 18) * Math.PI * 2 + rotation * (index % 2 ? 1 : -0.7);
      const distance = radius * (1.2 + ((index * 17) % 10) / 22);
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance * 0.56;
      coreContext.beginPath();
      coreContext.arc(x, y, index % 7 === 0 ? 2.6 : 1.1, 0, Math.PI * 2);
      coreContext.fillStyle = index % 7 === 0 ? "rgba(255, 122, 26, 0.95)" : "rgba(92, 224, 255, 0.7)";
      coreContext.fill();
    }
  }

  // مخطط القياس التجريبي.
  const chartCanvas = document.querySelector("#signal-chart");
  const chartContext = chartCanvas?.getContext("2d");
  const cpuValue = document.querySelector("#cpu-live");
  const ramValue = document.querySelector("#ram-live");
  const cpuMetric = document.querySelector('[data-value="38"]');
  const ramMetric = document.querySelector('[data-value="64"]');
  const data = {
    cpu: Array.from({ length: 60 }, (_, index) => 34 + Math.sin(index * 0.42) * 9 + Math.random() * 7),
    ram: Array.from({ length: 60 }, (_, index) => 61 + Math.sin(index * 0.18 + 1.3) * 5 + Math.random() * 3),
  };
  let chartWidth = 0;
  let chartHeight = 0;
  let chartDpr = 1;

  function resizeChart() {
    if (!chartCanvas || !chartContext) return;
    const rect = chartCanvas.getBoundingClientRect();
    chartDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    chartWidth = rect.width;
    chartHeight = rect.height;
    chartCanvas.width = Math.floor(chartWidth * chartDpr);
    chartCanvas.height = Math.floor(chartHeight * chartDpr);
    chartContext.setTransform(chartDpr, 0, 0, chartDpr, 0, 0);
    drawChart();
  }

  function linePath(values) {
    const padding = 18;
    const usableWidth = chartWidth - padding * 2;
    const usableHeight = chartHeight - padding * 2;
    const points = values.map((value, index) => ({
      x: padding + (index / (values.length - 1)) * usableWidth,
      y: padding + (1 - value / 100) * usableHeight,
    }));
    const path = new Path2D();
    path.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      path.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }
    path.lineTo(points.at(-1).x, points.at(-1).y);
    return { path, points, padding, usableHeight };
  }

  function drawSeries(values, color, glow, fill) {
    if (!chartContext) return;
    const { path, points } = linePath(values);
    chartContext.save();
    chartContext.strokeStyle = color;
    chartContext.lineWidth = 1.5;
    chartContext.shadowBlur = 12;
    chartContext.shadowColor = glow;
    chartContext.stroke(path);
    chartContext.shadowBlur = 0;

    const area = new Path2D(path);
    area.lineTo(points.at(-1).x, chartHeight);
    area.lineTo(points[0].x, chartHeight);
    area.closePath();
    const gradient = chartContext.createLinearGradient(0, 0, 0, chartHeight);
    gradient.addColorStop(0, fill);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    chartContext.fillStyle = gradient;
    chartContext.fill(area);

    const last = points.at(-1);
    chartContext.beginPath();
    chartContext.arc(last.x, last.y, 3.2, 0, Math.PI * 2);
    chartContext.fillStyle = color;
    chartContext.fill();
    chartContext.restore();
  }

  function drawChart() {
    if (!chartContext) return;
    chartContext.clearRect(0, 0, chartWidth, chartHeight);
    drawSeries(data.ram, "rgba(255, 132, 43, 0.9)", "#ff7a1a", "rgba(255, 122, 26, 0.065)");
    drawSeries(data.cpu, "rgba(89, 222, 255, 0.95)", "#42d9ff", "rgba(66, 217, 255, 0.085)");
  }

  function tickSimulation() {
    if (userPaused || document.hidden) return;
    const previousCpu = data.cpu.at(-1);
    const previousRam = data.ram.at(-1);
    const nextCpu = Math.max(18, Math.min(78, previousCpu + (Math.random() - 0.48) * 9));
    const nextRam = Math.max(46, Math.min(82, previousRam + (Math.random() - 0.5) * 3.5));
    data.cpu.push(nextCpu);
    data.cpu.shift();
    data.ram.push(nextRam);
    data.ram.shift();
    const cpuRounded = Math.round(nextCpu);
    const ramRounded = Math.round(nextRam);
    if (cpuValue) cpuValue.textContent = cpuRounded;
    if (ramValue) ramValue.textContent = ramRounded;
    if (cpuMetric) cpuMetric.textContent = cpuRounded;
    if (ramMetric) ramMetric.textContent = ramRounded;
    drawChart();
  }

  setInterval(tickSimulation, 1400);

  const simulationTime = document.querySelector("#simulation-time");
  function updateClock() {
    if (!simulationTime) return;
    simulationTime.textContent = new Intl.DateTimeFormat("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  }
  updateClock();
  setInterval(updateClock, 1000);

  const sections = [...document.querySelectorAll(".observable")];
  const navLinks = [...document.querySelectorAll(".main-nav a")];
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        navLinks.forEach((link) => link.classList.toggle("is-active", link.hash === `#${entry.target.id}`));
      }
    });
  }, { threshold: 0.32 });
  sections.forEach((section) => observer.observe(section));
  sections[0]?.classList.add("is-visible");

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeAmbient();
      resizeChart();
    }, 120);
  });

  function renderFrame(time = 0) {
    state.pointerX += (state.targetX - state.pointerX) * 0.045;
    state.pointerY += (state.targetY - state.pointerY) * 0.045;
    root.style.setProperty("--mx", state.pointerX.toFixed(3));
    root.style.setProperty("--my", state.pointerY.toFixed(3));
    drawAmbient(time);
    drawCore(time);
    state.frame += 1;
    if (motionIsActive()) requestAnimationFrame(renderFrame);
  }

  updateMotionUi();
  resizeAmbient();
  resizeChart();
  requestAnimationFrame(renderFrame);
})();
